/**
 * Task Scheduler
 *
 * Handles scheduling of one-time and recurring tasks.
 * Uses in-memory storage (tasks lost on restart).
 */

import cron from 'node-cron';
import { WebClient } from '@slack/web-api';
import { config } from '../config/index.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('scheduler');

const webClient = new WebClient(config.slack.botToken);

export interface ScheduledTask {
  id: number;
  userId: string;
  channelId: string;
  taskDescription: string;
  scheduledTime: number | null;
  cronExpression: string | null;
  threadTs: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
}

// In-memory task storage
const tasks: Map<number, ScheduledTask> = new Map();
let nextTaskId = 1;

// Active cron jobs
const activeJobs: Map<string, cron.ScheduledTask> = new Map();

class TaskScheduler {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting task scheduler');

    // Check for pending tasks every minute
    this.checkInterval = setInterval(() => {
      this.processPendingTasks();
    }, 60000);

    // Run initial check
    this.processPendingTasks();
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    activeJobs.forEach((job, id) => {
      job.stop();
      logger.debug(`Stopped cron job: ${id}`);
    });
    activeJobs.clear();

    this.isRunning = false;
    logger.info('Task scheduler stopped');
  }

  async scheduleTask(
    userId: string,
    channelId: string,
    description: string,
    scheduledTime: Date | null = null,
    cronExpression: string | null = null,
    threadTs: string | null = null
  ): Promise<ScheduledTask> {
    logger.info(`Scheduling task for user ${userId}: ${description}`);

    const task: ScheduledTask = {
      id: nextTaskId++,
      userId,
      channelId,
      taskDescription: description,
      scheduledTime: scheduledTime ? Math.floor(scheduledTime.getTime() / 1000) : null,
      cronExpression,
      threadTs,
      status: 'pending',
      createdAt: Math.floor(Date.now() / 1000),
    };

    tasks.set(task.id, task);

    if (cronExpression && cron.validate(cronExpression)) {
      this.setupCronJob(task);
    }

    return task;
  }

  private setupCronJob(task: ScheduledTask): void {
    if (!task.cronExpression) return;

    const jobId = `task-${task.id}`;

    if (activeJobs.has(jobId)) {
      logger.warn(`Cron job ${jobId} already exists`);
      return;
    }

    const job = cron.schedule(task.cronExpression, async () => {
      await this.executeTask(task);
    });

    activeJobs.set(jobId, job);
    logger.info(`Cron job scheduled: ${jobId} with expression ${task.cronExpression}`);
  }

  private async processPendingTasks(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    for (const task of tasks.values()) {
      if (task.status !== 'pending') continue;
      if (task.cronExpression) continue;
      if (task.scheduledTime && task.scheduledTime > now) continue;

      await this.executeTask(task);
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    logger.info(`Executing task ${task.id}: ${task.taskDescription}`);

    try {
      task.status = 'running';

      await webClient.chat.postMessage({
        channel: task.channelId,
        text: `⏰ *Reminder*: ${task.taskDescription}`,
        thread_ts: task.threadTs || undefined,
      });

      if (!task.cronExpression) {
        task.status = 'completed';
      } else {
        task.status = 'pending';
      }

      logger.info(`Task ${task.id} executed successfully`);
    } catch (error) {
      logger.error(`Failed to execute task ${task.id}`, { error });
      task.status = 'failed';
    }
  }

  getUserTasks(userId: string): ScheduledTask[] {
    return Array.from(tasks.values()).filter(
      t => t.userId === userId && t.status !== 'cancelled' && t.status !== 'completed'
    );
  }

  cancelTask(taskId: number, userId: string): boolean {
    const task = tasks.get(taskId);
    if (!task || task.userId !== userId) return false;

    const jobId = `task-${taskId}`;
    const job = activeJobs.get(jobId);
    if (job) {
      job.stop();
      activeJobs.delete(jobId);
    }

    task.status = 'cancelled';
    return true;
  }
}

export const taskScheduler = new TaskScheduler();
