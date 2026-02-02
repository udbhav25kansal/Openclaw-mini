/**
 * Slack AI Assistant - Main Entry Point
 *
 * Features:
 * - RAG (Retrieval Augmented Generation) for Slack history search
 * - AI agent with tool calling
 * - Task scheduling
 */

import { config } from './config/index.js';
import { createModuleLogger } from './utils/logger.js';
import { initializeVectorStore, startIndexer, stopIndexer, getDocumentCount } from './rag/index.js';
import { startSlackApp, stopSlackApp } from './channels/slack.js';
import { taskScheduler } from './tools/scheduler.js';
import { initializeMCP, shutdownMCP, isMCPEnabled, getConnectedServers } from './mcp/index.js';
import { initializeDatabase, closeDatabase } from './memory/database.js';
import { initializeMemory, isMemoryEnabled } from './memory-ai/index.js';

const logger = createModuleLogger('main');

async function main(): Promise<void> {
  logger.info('='.repeat(50));
  logger.info('Starting Slack AI Assistant');
  logger.info('='.repeat(50));

  try {
    // Initialize database
    logger.info('Initializing database...');
    initializeDatabase();

    // Initialize mem0 memory
    if (config.memory.enabled) {
      logger.info('Initializing mem0 memory...');
      await initializeMemory();
      logger.info(`Memory: ${isMemoryEnabled() ? 'Enabled' : 'Disabled (initialization failed)'}`);
    } else {
      logger.info('Memory system disabled');
    }

    // Initialize RAG system
    if (config.rag.enabled) {
      logger.info('Initializing RAG system...');
      await initializeVectorStore();
      const docCount = await getDocumentCount();
      logger.info(`Vector store initialized (${docCount} documents)`);

      startIndexer();
      logger.info('Background indexer started');
    } else {
      logger.info('RAG system disabled');
    }

    // Initialize MCP servers
    logger.info('Initializing MCP servers...');
    await initializeMCP();
    if (isMCPEnabled()) {
      logger.info(`MCP enabled with servers: ${getConnectedServers().join(', ')}`);
    } else {
      logger.info('MCP: No servers configured');
    }

    // Start task scheduler
    logger.info('Starting task scheduler...');
    taskScheduler.start();

    // Start Slack app
    logger.info('Starting Slack app...');
    await startSlackApp();

    logger.info('='.repeat(50));
    logger.info('Slack AI Assistant is running!');
    logger.info('='.repeat(50));
    logger.info(`RAG: ${config.rag.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`Memory: ${isMemoryEnabled() ? 'Enabled' : 'Disabled'}`);
    logger.info(`MCP: ${isMCPEnabled() ? `Enabled (${getConnectedServers().join(', ')})` : 'Disabled'}`);
    logger.info(`Model: ${config.ai.defaultModel}`);
    logger.info('='.repeat(50));

  } catch (error: any) {
    logger.error('Failed to start application', { error: error.message });
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down...`);

  try {
    await stopSlackApp();
    taskScheduler.stop();
    await shutdownMCP();

    if (config.rag.enabled) {
      stopIndexer();
    }

    closeDatabase();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});

main();
