/**
 * Check memories stored in mem0 for a user
 */

import 'dotenv/config';

const MEM0_API_BASE = 'https://api.mem0.ai/v1';
const apiKey = process.env.MEM0_API_KEY;

if (!apiKey) {
  console.error('MEM0_API_KEY not set');
  process.exit(1);
}

async function checkMemories(userId: string) {
  console.log(`\n=== Checking memories for user: ${userId} ===\n`);

  // Get all memories for the user
  const response = await fetch(`${MEM0_API_BASE}/memories/?user_id=${encodeURIComponent(userId)}`, {
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.error('Error:', await response.text());
    return;
  }

  const data = await response.json();
  const memories = data.results || data || [];

  console.log(`Found ${Array.isArray(memories) ? memories.length : 0} memories:\n`);

  if (Array.isArray(memories)) {
    memories.forEach((m: any, i: number) => {
      console.log(`${i + 1}. ${m.memory}`);
      console.log(`   ID: ${m.id}`);
      console.log(`   Created: ${m.created_at}`);
      console.log('');
    });
  } else {
    console.log('Raw response:', JSON.stringify(data, null, 2));
  }
}

async function searchMemories(userId: string, query: string) {
  console.log(`\n=== Searching memories for "${query}" ===\n`);

  const body = {
    query,
    user_id: userId,
    limit: 10,
  };

  console.log('Request body:', JSON.stringify(body));

  const response = await fetch(`${MEM0_API_BASE}/memories/search/`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  console.log('Response status:', response.status);

  const data = await response.json();
  console.log('Raw response:', JSON.stringify(data, null, 2));

  const memories = data.results || [];

  console.log(`Found ${memories.length} relevant memories:\n`);

  memories.forEach((m: any, i: number) => {
    console.log(`${i + 1}. ${m.memory} (score: ${m.score})`);
  });
}

// Check for the Slack user
const userId = 'U0ABUL6R7D5';

async function main() {
  await checkMemories(userId);

  // Test one search with debug output
  await searchMemories(userId, 'pasta');
}

main().catch(console.error);
