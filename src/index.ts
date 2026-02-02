/**
 * Slack AI Assistant v2 - Main Entry Point
 *
 * This is the entry point for the advanced Slack AI Assistant with:
 * - RAG (Retrieval Augmented Generation) for semantic search
 * - mem0 Long-Term Memory for personalization
 * - MCP (Model Context Protocol) for GitHub, Notion integration
 * - Background message indexing
 * - Tool-using AI agent
 *
 * STARTUP SEQUENCE:
 * -----------------
 * 1. Load configuration from environment
 * 2. Initialize vector store (ChromaDB for RAG)
 * 3. Start background indexer (if RAG enabled)
 * 4. Handle graceful shutdown
 *
 * TODO: Add these modules later:
 * - Database (SQLite for sessions)
 * - Memory system (mem0)
 * - MCP servers (GitHub, Notion)
 * - Slack app
 * - Task scheduler
 */

import { config } from './config/index.js';
import { createModuleLogger } from './utils/logger.js';

// RAG imports
import { initializeVectorStore, startIndexer, stopIndexer, getDocumentCount } from './rag/index.js';

// TODO: Add these imports later
// import { initializeDatabase, closeDatabase } from './memory/database.js';
// import { startSlackApp, stopSlackApp } from './channels/slack.js';
// import { taskScheduler } from './tools/scheduler.js';
// import { initializeMemory, isMemoryEnabled } from './memory-ai/index.js';
// import { initializeMCP, shutdownMCP, isMCPEnabled, getConnectedServers } from './mcp/index.js';

const logger = createModuleLogger('main');

/**
 * Initialize all services and start the application.
 */
async function main(): Promise<void> {
  logger.info('='.repeat(50));
  logger.info('Starting Slack AI Assistant v2');
  logger.info('='.repeat(50));

  try {
    // Initialize RAG system if enabled
    if (config.rag.enabled) {
      logger.info('Initializing RAG system...');

      // Initialize vector store
      await initializeVectorStore();
      const docCount = await getDocumentCount();
      logger.info(`Vector store initialized (${docCount} documents)`);

      // Start background indexer
      startIndexer();
      logger.info('Background indexer started');
    } else {
      logger.info('RAG system disabled');
    }

    // Ready!
    logger.info('='.repeat(50));
    logger.info('Slack AI Assistant v2 - RAG Module Ready');
    logger.info('='.repeat(50));
    logger.info('Features enabled:');
    logger.info(`  - RAG (Semantic Search): ${config.rag.enabled ? 'YES' : 'NO'}`);
    logger.info(`  - Long-Term Memory: TODO`);
    logger.info(`  - MCP (GitHub/Notion): TODO`);
    logger.info(`  - Slack App: TODO`);
    logger.info(`  - Task Scheduler: TODO`);
    logger.info('='.repeat(50));
    logger.info('Press Ctrl+C to stop');

  } catch (error: any) {
    logger.error('Failed to start application', { error: error.message });
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler.
 * Ensures all services are properly stopped.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`\n${signal} received, shutting down gracefully...`);

  try {
    // Stop indexer
    if (config.rag.enabled) {
      logger.info('Stopping indexer...');
      stopIndexer();
    }

    // TODO: Add these later
    // await stopSlackApp();
    // await shutdownMCP();
    // taskScheduler.stop();
    // closeDatabase();

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});

// Start the application
main();
