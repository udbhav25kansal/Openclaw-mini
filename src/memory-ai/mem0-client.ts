/**
 * mem0 Memory Client (REST API)
 *
 * This module integrates mem0.ai for long-term user memory using the REST API.
 * mem0 automatically extracts facts from conversations and stores them,
 * enabling personalized AI experiences across sessions.
 *
 * NOTE: We use the REST API directly because the npm package has browser-only
 * dependencies that don't work in Node.js.
 */

import { config } from '../config/index.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('mem0-client');

// mem0 API configuration
const MEM0_API_BASE = 'https://api.mem0.ai/v1';
let apiKey: string | null = null;
let isInitialized = false;

// Types for mem0 responses
export interface MemoryItem {
  id: string;
  memory: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  score?: number;  // For search results
}

export interface AddMemoryResult {
  results: MemoryItem[];
}

export interface SearchMemoryResult {
  results: MemoryItem[];
}

/**
 * Make a request to the mem0 API.
 */
async function mem0Request(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, unknown>
): Promise<any> {
  if (!apiKey) {
    throw new Error('mem0 not initialized');
  }

  const url = `${MEM0_API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    'Authorization': `Token ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`mem0 API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Initialize the mem0 memory client.
 */
export async function initializeMemory(): Promise<void> {
  if (isInitialized) {
    logger.debug('Memory already initialized');
    return;
  }

  try {
    logger.info('Initializing mem0 REST API client...');

    apiKey = process.env.MEM0_API_KEY || null;
    if (!apiKey) {
      throw new Error('MEM0_API_KEY environment variable is required');
    }

    // Test the connection by getting memories for a test user
    // This will return an empty array if no memories exist, validating the API key
    await mem0Request('/memories/?user_id=system_test', 'GET');

    isInitialized = true;
    logger.info('✅ mem0 REST API client initialized');
  } catch (error: any) {
    logger.error(`Failed to initialize mem0: ${error.message}`);
    logger.warn('Memory features will be disabled');
    isInitialized = false;
    apiKey = null;
  }
}

/**
 * Add memories from a conversation.
 * mem0 will automatically extract facts from the messages.
 *
 * @param messages - Conversation messages
 * @param userId - Slack user ID
 * @param metadata - Optional metadata
 */
export async function addMemory(
  messages: Array<{ role: string; content: string }>,
  userId: string,
  metadata?: Record<string, unknown>
): Promise<MemoryItem[]> {
  if (!isInitialized) {
    logger.warn('Memory not initialized, skipping add');
    return [];
  }

  try {
    logger.debug(`Adding memories for user ${userId}`);

    const result = await mem0Request('/memories/', 'POST', {
      messages,
      user_id: userId,
      metadata: {
        source: 'slack',
        ...metadata,
      },
    });

    const memories = result?.results || result || [];

    if (Array.isArray(memories) && memories.length > 0) {
      logger.info(`Stored ${memories.length} memories for user ${userId}`);
      memories.forEach((m: MemoryItem) => {
        logger.debug(`  - ${m.memory}`);
      });
    }

    return memories;
  } catch (error: any) {
    logger.error(`Failed to add memory: ${error.message}`);
    return [];
  }
}

/**
 * Search for relevant memories.
 *
 * @param query - Search query
 * @param userId - Slack user ID
 * @param limit - Max results
 */
export async function searchMemory(
  query: string,
  userId: string,
  limit: number = 5
): Promise<MemoryItem[]> {
  if (!isInitialized) {
    logger.warn('Memory not initialized, skipping search');
    return [];
  }

  try {
    logger.info(`Searching memories for user ${userId}: "${query.substring(0, 50)}..."`);

    const result = await mem0Request('/memories/search/', 'POST', {
      query,
      user_id: userId,
      limit,
    });

    // API returns array directly, not wrapped in {results: [...]}
    const memories = Array.isArray(result) ? result : (result?.results || []);

    if (memories.length > 0) {
      logger.info(`Found ${memories.length} relevant memories for user ${userId}`);
      memories.forEach((m: MemoryItem) => {
        logger.debug(`  Memory: ${m.memory} (score: ${m.score})`);
      });
    } else {
      logger.debug(`No memories found for user ${userId}`);
    }

    return memories;
  } catch (error: any) {
    logger.error(`Failed to search memory: ${error.message}`);
    return [];
  }
}

/**
 * Get all memories for a user.
 *
 * @param userId - Slack user ID
 */
export async function getAllMemories(userId: string): Promise<MemoryItem[]> {
  if (!isInitialized) {
    logger.warn('Memory not initialized, skipping getAll');
    return [];
  }

  try {
    logger.debug(`Getting all memories for user ${userId}`);

    const result = await mem0Request(`/memories/?user_id=${encodeURIComponent(userId)}`, 'GET');
    const memories = result?.results || result || [];

    logger.debug(`User ${userId} has ${Array.isArray(memories) ? memories.length : 0} memories`);

    return Array.isArray(memories) ? memories : [];
  } catch (error: any) {
    logger.error(`Failed to get memories: ${error.message}`);
    return [];
  }
}

/**
 * Delete a specific memory.
 *
 * @param memoryId - Memory ID to delete
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  if (!isInitialized) {
    logger.warn('Memory not initialized, skipping delete');
    return false;
  }

  try {
    logger.debug(`Deleting memory: ${memoryId}`);
    await mem0Request(`/memories/${memoryId}/`, 'DELETE');
    logger.info(`Deleted memory: ${memoryId}`);
    return true;
  } catch (error: any) {
    logger.error(`Failed to delete memory: ${error.message}`);
    return false;
  }
}

/**
 * Delete all memories for a user.
 *
 * @param userId - Slack user ID
 */
export async function deleteAllMemories(userId: string): Promise<boolean> {
  if (!isInitialized) {
    logger.warn('Memory not initialized, skipping deleteAll');
    return false;
  }

  try {
    logger.debug(`Deleting all memories for user ${userId}`);
    await mem0Request(`/memories/?user_id=${encodeURIComponent(userId)}`, 'DELETE');
    logger.info(`Deleted all memories for user ${userId}`);
    return true;
  } catch (error: any) {
    logger.error(`Failed to delete all memories: ${error.message}`);
    return false;
  }
}

/**
 * Build a context string from memories for the LLM.
 *
 * @param memories - Array of memories
 * @returns Formatted context string
 */
export function buildMemoryContext(memories: MemoryItem[]): string {
  if (memories.length === 0) {
    return '';
  }

  const header = '## What I Remember About You\n\n';
  const items = memories.map((m, i) => `${i + 1}. ${m.memory}`).join('\n');
  const footer = '\n\nUse this context to personalize your responses.';

  return header + items + footer;
}

/**
 * Check if memory is initialized and available.
 */
export function isMemoryEnabled(): boolean {
  return isInitialized;
}

/**
 * Get memory system status.
 */
export function getMemoryStatus(): {
  enabled: boolean;
  initialized: boolean;
} {
  return {
    enabled: config.memory?.enabled ?? true,
    initialized: isInitialized,
  };
}
