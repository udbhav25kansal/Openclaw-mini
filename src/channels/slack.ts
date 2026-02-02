/**
 * Slack Bot - Channel Adapter
 *
 * Connects the AI agent to Slack using Socket Mode.
 * Handles messages, mentions, and commands.
 */

import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { config } from '../config/index.js';
import { createModuleLogger } from '../utils/logger.js';
import { processMessage, AgentContext } from '../agents/agent.js';
import { taskScheduler } from '../tools/scheduler.js';
import { getOrCreateSession as dbGetOrCreateSession, isUserApproved, generatePairingCode, approvePairing } from '../memory/database.js';

const logger = createModuleLogger('slack');

// Initialize Slack Bolt App
export const slackApp = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  socketMode: true,
  logLevel: config.app.logLevel === 'debug' ? LogLevel.DEBUG : LogLevel.INFO,
});

export const webClient = new WebClient(config.slack.botToken);

let botUserId: string | null = null;

function getOrCreateSession(userId: string, channelId: string, threadTs: string | null): { id: string } {
  const session = dbGetOrCreateSession(userId, channelId, threadTs);
  return { id: session.id };
}

async function getBotUserId(): Promise<string> {
  if (botUserId) return botUserId;
  const authResult = await webClient.auth.test();
  botUserId = authResult.user_id as string;
  return botUserId;
}

function isBotMentioned(text: string, botId: string): boolean {
  return text.includes(`<@${botId}>`);
}

function removeBotMention(text: string, botId: string): string {
  return text.replace(new RegExp(`<@${botId}>\\s*`, 'g'), '').trim();
}

function isDirectMessage(channelId: string): boolean {
  return channelId.startsWith('D');
}

async function addReaction(channelId: string, timestamp: string, emoji: string): Promise<void> {
  if (!config.features.reactions) return;
  try {
    await webClient.reactions.add({ channel: channelId, timestamp, name: emoji });
  } catch (error) {
    logger.debug(`Failed to add reaction ${emoji}`, { error });
  }
}

async function removeReaction(channelId: string, timestamp: string, emoji: string): Promise<void> {
  try {
    await webClient.reactions.remove({ channel: channelId, timestamp, name: emoji });
  } catch (error) {
    logger.debug(`Failed to remove reaction ${emoji}`, { error });
  }
}

async function getUserInfo(userId: string): Promise<{ name: string; realName: string }> {
  try {
    const result = await webClient.users.info({ user: userId });
    return {
      name: result.user?.name || 'unknown',
      realName: result.user?.real_name || result.user?.name || 'unknown',
    };
  } catch {
    return { name: 'unknown', realName: 'unknown' };
  }
}

async function getChannelInfo(channelId: string): Promise<{ name: string }> {
  try {
    const result = await webClient.conversations.info({ channel: channelId });
    return { name: result.channel?.name || 'unknown' };
  } catch {
    return { name: 'unknown' };
  }
}

// Handle messages
slackApp.message(async ({ message, say }) => {
  if (message.subtype !== undefined || !('text' in message)) return;

  const { text, user, channel, ts, thread_ts } = message;
  if (!text || !user) return;

  const currentBotId = await getBotUserId();
  if (user === currentBotId) return;

  logger.info(`Message received from ${user} in ${channel}`);

  const isDM = isDirectMessage(channel);

  // In channels, only respond if mentioned
  if (!isDM && !isBotMentioned(text, currentBotId)) {
    return;
  }

  // DM security check (if pairing policy is enabled)
  if (isDM && config.security.dmPolicy === 'pairing' && !isUserApproved(user)) {
    const code = generatePairingCode(user);
    await say({
      text: `To use this bot in DMs, please get approved by an admin.\n\nYour pairing code: \`${code}\`\n\nAsk an admin to approve you in a channel with: \`approve ${code}\``,
    });
    return;
  }

  const cleanText = isDM ? text : removeBotMention(text, currentBotId);

  // Handle help command
  if (cleanText.toLowerCase() === 'help') {
    await say({
      text: `🤖 *Slack AI Assistant*\n\n*I can help with:*\n• Answer questions about Slack history (RAG search)\n• Send messages to channels/users\n• Schedule messages and reminders\n• List channels and users\n\n*Commands:*\n• \`help\` - Show this message\n• \`my tasks\` - List your scheduled tasks\n• \`cancel task [id]\` - Cancel a task\n\n*Tips:*\n• Ask about past discussions: "What did we decide about X?"\n• Mention me in channels: <@${currentBotId}>`,
      thread_ts: thread_ts || ts,
    });
    return;
  }

  // Handle task listing
  if (cleanText.toLowerCase() === 'my tasks') {
    const tasks = taskScheduler.getUserTasks(user);
    if (tasks.length === 0) {
      await say({ text: "You don't have any scheduled tasks.", thread_ts: thread_ts || ts });
    } else {
      const taskList = tasks.map(t =>
        `• [${t.id}] ${t.taskDescription} - ${t.status}`
      ).join('\n');
      await say({ text: `📋 *Your Tasks:*\n${taskList}`, thread_ts: thread_ts || ts });
    }
    return;
  }

  // Handle task cancellation
  const cancelMatch = cleanText.match(/cancel task (\d+)/i);
  if (cancelMatch) {
    const taskId = parseInt(cancelMatch[1], 10);
    const success = taskScheduler.cancelTask(taskId, user);
    await say({
      text: success ? `Task ${taskId} cancelled.` : `Could not cancel task ${taskId}.`,
      thread_ts: thread_ts || ts,
    });
    return;
  }

  // Handle pairing code approval (admin command)
  const approveMatch = cleanText.match(/approve ([A-Z0-9]{6})/i);
  if (approveMatch && !isDM) {
    const code = approveMatch[1].toUpperCase();
    const success = approvePairing(code, user);
    await say({
      text: success ? `Pairing code \`${code}\` approved!` : `Invalid or expired pairing code: \`${code}\``,
      thread_ts: thread_ts || ts,
    });
    return;
  }

  // Process with AI agent
  await addReaction(channel, ts, 'eyes');

  try {
    const session = getOrCreateSession(user, channel, thread_ts || null);
    const userInfo = await getUserInfo(user);
    const channelInfo = isDM ? { name: 'DM' } : await getChannelInfo(channel);

    const context: AgentContext = {
      sessionId: session.id,
      userId: user,
      channelId: channel,
      threadTs: thread_ts || null,
      userName: userInfo.realName,
      channelName: channelInfo.name,
    };

    const response = await processMessage(cleanText, context);

    await removeReaction(channel, ts, 'eyes');

    await say({
      text: response.content,
      thread_ts: response.shouldThread ? thread_ts || ts : undefined,
    });
  } catch (error) {
    logger.error('Failed to process message', { error });
    await removeReaction(channel, ts, 'eyes');
    await addReaction(channel, ts, 'warning');
    await say({
      text: "Sorry, I encountered an error. Please try again.",
      thread_ts: thread_ts || ts,
    });
  }
});

// Handle app mentions
slackApp.event('app_mention', async ({ event, say }) => {
  const { user, channel, ts, thread_ts, text } = event;

  logger.info(`App mentioned by ${user} in ${channel}`);

  const currentBotId = await getBotUserId();
  const cleanText = removeBotMention(text, currentBotId);

  await addReaction(channel, ts, 'eyes');

  try {
    const session = getOrCreateSession(user, channel, thread_ts || null);

    const context: AgentContext = {
      sessionId: session.id,
      userId: user,
      channelId: channel,
      threadTs: thread_ts || null,
    };

    const response = await processMessage(cleanText, context);

    await removeReaction(channel, ts, 'eyes');

    await say({
      text: response.content,
      thread_ts: thread_ts || ts,
    });
  } catch (error) {
    logger.error('Failed to process app mention', { error });
    await removeReaction(channel, ts, 'eyes');
    await say({
      text: "Sorry, I encountered an error. Please try again.",
      thread_ts: thread_ts || ts,
    });
  }
});

// Startup
export async function startSlackApp(): Promise<void> {
  try {
    await slackApp.start();
    const botId = await getBotUserId();
    logger.info(`Slack app started! Bot user ID: ${botId}`);
  } catch (error) {
    logger.error('Failed to start Slack app', { error });
    throw error;
  }
}

export async function stopSlackApp(): Promise<void> {
  await slackApp.stop();
  logger.info('Slack app stopped');
}
