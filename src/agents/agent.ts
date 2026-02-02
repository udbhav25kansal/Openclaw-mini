/**
 * RAG-Enhanced AI Agent
 *
 * This agent uses RAG (Retrieval Augmented Generation) to search
 * through Slack message history and provide context-aware responses.
 */

import OpenAI from 'openai';
import { config } from '../config/index.js';
import { createModuleLogger } from '../utils/logger.js';
import {
  shouldUseRAG,
  retrieve,
  buildContextString,
  parseQueryFilters,
} from '../rag/index.js';
import {
  sendMessage,
  getChannelHistory,
  findChannel,
  listUsers,
  listChannels,
  formatMessagesForContext,
  scheduleMessage,
  setReminder,
} from '../tools/slack-actions.js';
import {
  getAllMCPTools,
  executeMCPTool,
  parseToolName,
  isMCPEnabled,
  mcpToolsToOpenAI,
  formatMCPResult,
} from '../mcp/index.js';
import {
  addMessage as dbAddMessage,
  getSessionHistory as dbGetSessionHistory,
} from '../memory/database.js';
import {
  searchMemory,
  addMemory,
  buildMemoryContext,
  isMemoryEnabled,
} from '../memory-ai/index.js';

const logger = createModuleLogger('agent');

const openaiClient = new OpenAI({ apiKey: config.ai.openaiApiKey });

function getSessionHistory(sessionId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages = dbGetSessionHistory(sessionId, config.app.maxHistoryMessages);
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

function addMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
  dbAddMessage(sessionId, role, content);
}

const SYSTEM_PROMPT = `You are a helpful AI assistant integrated into Slack.

## Your Capabilities:

### Slack History (RAG):
- You can search through indexed Slack message history using semantic search
- Use search_knowledge_base for questions about past discussions, decisions, or topics
- Use get_channel_history for recent/live messages

### Slack Actions:
- send_message: Send messages to channels or users
- schedule_message: Schedule messages for later
- set_reminder: Set reminders
- list_channels: See available channels
- list_users: See workspace users

### External Integrations (MCP):
- GitHub tools (prefixed with github_): Create issues, manage PRs, search repos
- Notion tools (prefixed with notion_): Create pages, search databases, manage content

## Response Format:
- Be concise
- Use Slack formatting: *bold*, _italic_, \`code\`
- Cite sources when using search results`;

const SLACK_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description: 'Search through indexed Slack message history using semantic search. Use for questions about past discussions, topics, or decisions.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query - what to look for in message history',
          },
          channel_name: {
            type: 'string',
            description: 'Optional: limit search to a specific channel name',
          },
          limit: {
            type: 'number',
            description: 'Number of results (default 10)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a message to a Slack user or channel',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Channel name (e.g., "general") or user name' },
          message: { type: 'string', description: 'The message to send' },
        },
        required: ['target', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_channel_history',
      description: 'Get recent messages from a Slack channel',
      parameters: {
        type: 'object',
        properties: {
          channel_name: { type: 'string', description: 'Channel name without # prefix' },
          limit: { type: 'number', description: 'Number of messages (default 20)' },
        },
        required: ['channel_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_message',
      description: 'Schedule a message to be sent later',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Channel or user name' },
          message: { type: 'string', description: 'Message to send' },
          send_at: { type: 'string', description: 'ISO 8601 timestamp, e.g., "2026-01-28T10:30:00+05:30"' },
        },
        required: ['target', 'message', 'send_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a reminder for the user',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Reminder text' },
          time: { type: 'string', description: 'When to remind, e.g., "in 5 minutes", "tomorrow at 9am"' },
        },
        required: ['text', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_channels',
      description: 'List all accessible Slack channels',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_users',
      description: 'List all users in the workspace',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export interface AgentContext {
  sessionId: string;
  userId: string;
  channelId: string | null;
  threadTs: string | null;
  channelName?: string;
  userName?: string;
}

export interface AgentResponse {
  content: string;
  shouldThread: boolean;
  ragUsed: boolean;
  sourcesCount: number;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: AgentContext
): Promise<string> {
  logger.info(`Executing tool: ${name}`, { args });

  try {
    switch (name) {
      case 'search_knowledge_base': {
        let channelNameFilter = args.channel_name as string | undefined;
        let searchQuery = args.query as string;

        searchQuery = searchQuery
          .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
          .replace(/<#[A-Z0-9]+>/g, '')
          .replace(/<@[A-Z0-9]+>/g, '')
          .replace(/<https?:\/\/[^>]+>/g, '')
          .trim();

        if (channelNameFilter) {
          channelNameFilter = channelNameFilter
            .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '$1')
            .replace(/^#/, '')
            .trim();
        }

        logger.info(`RAG search: query="${searchQuery}", channel="${channelNameFilter || 'all'}"`);

        const results = await retrieve(searchQuery, {
          limit: (args.limit as number) || 10,
          channelName: channelNameFilter,
          minScore: 0.3,
        });

        if (results.results.length === 0) {
          return `No relevant messages found for "${searchQuery}"${channelNameFilter ? ` in #${channelNameFilter}` : ''}.`;
        }

        const formatted = results.results.map((r, i) =>
          `${i + 1}. ${r.formatted} (relevance: ${(r.score * 100).toFixed(0)}%)`
        ).join('\n');

        return `Found ${results.results.length} relevant messages:\n\n${formatted}`;
      }

      case 'send_message': {
        const result = await sendMessage(args.target as string, args.message as string);
        return result.success
          ? `Message sent to ${args.target}`
          : `Failed: ${result.error}`;
      }

      case 'get_channel_history': {
        const channel = await findChannel(args.channel_name as string);
        if (!channel) return `Channel not found: ${args.channel_name}`;

        const messages = await getChannelHistory(channel.id, (args.limit as number) || 20);
        if (messages.length === 0) return `No messages found in #${channel.name}`;

        return `Recent messages from #${channel.name}:\n\n${formatMessagesForContext(messages)}`;
      }

      case 'schedule_message': {
        const sendAt = new Date(args.send_at as string);
        if (isNaN(sendAt.getTime())) {
          return `Invalid date format: ${args.send_at}`;
        }

        const result = await scheduleMessage(args.target as string, args.message as string, sendAt);
        return result.success
          ? `Message scheduled for ${sendAt.toLocaleString()}`
          : `Failed: ${result.error}`;
      }

      case 'set_reminder': {
        const result = await setReminder(context.userId, args.text as string, args.time as string);
        return result.success
          ? `Reminder set: "${args.text}" at ${args.time}`
          : `Failed: ${result.error}`;
      }

      case 'list_channels': {
        const channels = await listChannels();
        const memberChannels = channels.filter(c => c.isMember);
        return `Channels I'm in (${memberChannels.length}):\n${memberChannels.map(c => `- #${c.name}`).join('\n')}`;
      }

      case 'list_users': {
        const users = await listUsers();
        const list = users.slice(0, 20).map(u => `- ${u.realName} (@${u.name})`).join('\n');
        return `Users (${users.length}):\n${list}${users.length > 20 ? '\n...' : ''}`;
      }

      default: {
        // Check if it's an MCP tool
        const parsed = parseToolName(name);
        if (parsed && isMCPEnabled()) {
          logger.info(`Executing MCP tool: ${parsed.serverName}/${parsed.toolName}`);
          const result = await executeMCPTool(parsed.serverName, parsed.toolName, args);
          return formatMCPResult(result);
        }
        return `Unknown tool: ${name}`;
      }
    }
  } catch (error: any) {
    logger.error(`Tool execution failed: ${name}`, { error });
    return `Error: ${error.message}`;
  }
}

export async function processMessage(
  userMessage: string,
  context: AgentContext
): Promise<AgentResponse> {
  logger.info(`Processing message for session: ${context.sessionId}`);

  addMessage(context.sessionId, 'user', userMessage);

  let ragContext = '';
  let ragUsed = false;
  let sourcesCount = 0;
  let memoryContext = '';

  // Retrieve RAG context
  if (config.rag.enabled && shouldUseRAG(userMessage)) {
    logger.info('RAG triggered for query');

    try {
      const filters = parseQueryFilters(userMessage);
      const results = await retrieve(userMessage, {
        limit: config.rag.maxResults,
        minScore: config.rag.minSimilarity,
        channelName: filters.channelName,
      });

      if (results.results.length > 0) {
        ragContext = buildContextString(results.results);
        ragUsed = true;
        sourcesCount = results.results.length;
        logger.info(`RAG found ${sourcesCount} relevant documents`);
      }
    } catch (error: any) {
      logger.error(`RAG retrieval failed: ${error.message}`);
    }
  }

  // Retrieve mem0 long-term memory
  if (isMemoryEnabled()) {
    try {
      const memories = await searchMemory(userMessage, context.userId, 5);
      if (memories.length > 0) {
        memoryContext = buildMemoryContext(memories);
        logger.info(`Memory found ${memories.length} relevant facts about user`);
      }
    } catch (error: any) {
      logger.error(`Memory retrieval failed: ${error.message}`);
    }
  }

  const history = getSessionHistory(context.sessionId);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Add memory context (what we know about the user)
  if (memoryContext) {
    messages.push({
      role: 'system',
      content: memoryContext
    });
  }

  // Add RAG context (relevant Slack history)
  if (ragContext) {
    messages.push({
      role: 'system',
      content: `The following context from Slack history may be relevant:\n\n${ragContext}`
    });
  }

  for (const msg of history.slice(-10)) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  messages.push({ role: 'user', content: userMessage });

  // Combine Slack tools with MCP tools
  const mcpTools = isMCPEnabled() ? mcpToolsToOpenAI(getAllMCPTools()) : [];
  const tools = [...SLACK_TOOLS, ...mcpTools];
  logger.info(`Calling LLM with ${tools.length} tools (${SLACK_TOOLS.length} Slack + ${mcpTools.length} MCP)`);

  let response = await openaiClient.chat.completions.create({
    model: config.ai.defaultModel.includes('gpt') ? config.ai.defaultModel : 'gpt-4o',
    messages,
    tools,
    tool_choice: 'auto',
    max_tokens: 4096,
  });

  let assistantMessage = response.choices[0]?.message;

  while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await executeTool(toolCall.function.name, args, context);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    response = await openaiClient.chat.completions.create({
      model: config.ai.defaultModel.includes('gpt') ? config.ai.defaultModel : 'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4096,
    });

    assistantMessage = response.choices[0]?.message;
  }

  const content = assistantMessage?.content || 'I encountered an error processing your request.';

  addMessage(context.sessionId, 'assistant', content);

  // Store memories from this conversation (async, don't block response)
  if (isMemoryEnabled()) {
    addMemory(
      [
        { role: 'user', content: userMessage },
        { role: 'assistant', content },
      ],
      context.userId
    ).catch(err => logger.error(`Failed to store memory: ${err.message}`));
  }

  return {
    content,
    shouldThread: context.threadTs !== null || content.length > 500,
    ragUsed,
    sourcesCount,
  };
}

export { processMessage as default };
