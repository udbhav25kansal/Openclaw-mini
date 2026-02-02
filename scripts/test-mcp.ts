/**
 * Test MCP Connections
 *
 * Quick test to verify GitHub and Notion MCP servers are working.
 */

import 'dotenv/config';
import { initializeMCP, getAllMCPTools, executeMCPTool, shutdownMCP, isMCPEnabled, getConnectedServers } from '../src/mcp/index.js';
import { createModuleLogger } from '../src/utils/logger.js';

const logger = createModuleLogger('mcp-test');

async function main() {
  console.log('='.repeat(50));
  console.log('Testing MCP Connections');
  console.log('='.repeat(50));

  try {
    // Initialize MCP
    console.log('\n1. Initializing MCP servers...');
    await initializeMCP();

    if (!isMCPEnabled()) {
      console.log('❌ No MCP servers connected!');
      process.exit(1);
    }

    const servers = getConnectedServers();
    console.log(`✅ Connected servers: ${servers.join(', ')}`);

    // List available tools
    console.log('\n2. Available tools:');
    const tools = getAllMCPTools();
    console.log(`   Total: ${tools.length} tools\n`);

    // Group by server
    const githubTools = tools.filter(t => t.serverName === 'github');
    const notionTools = tools.filter(t => t.serverName === 'notion');

    console.log(`   GitHub (${githubTools.length} tools):`);
    githubTools.slice(0, 5).forEach(t => console.log(`     - ${t.name}`));
    if (githubTools.length > 5) console.log(`     ... and ${githubTools.length - 5} more`);

    console.log(`\n   Notion (${notionTools.length} tools):`);
    notionTools.slice(0, 5).forEach(t => console.log(`     - ${t.name}`));
    if (notionTools.length > 5) console.log(`     ... and ${notionTools.length - 5} more`);

    // Test GitHub - search repositories
    console.log('\n3. Testing GitHub API...');
    try {
      const githubResult = await executeMCPTool('github', 'search_repositories', { query: 'openclaw' });
      console.log('✅ GitHub API working!');
      console.log('   Response:', JSON.stringify(githubResult).substring(0, 300) + '...');
    } catch (error: any) {
      console.log('❌ GitHub API failed:', error.message);
    }

    // Test Notion - search via API
    console.log('\n4. Testing Notion API...');
    try {
      const notionResult = await executeMCPTool('notion', 'API-post-search', { query: 'test' });
      console.log('✅ Notion API working!');
      console.log('   Response:', JSON.stringify(notionResult).substring(0, 300) + '...');
    } catch (error: any) {
      console.log('❌ Notion API failed:', error.message);
    }

    console.log('\n' + '='.repeat(50));
    console.log('MCP Test Complete!');
    console.log('='.repeat(50));

  } catch (error: any) {
    console.error('Test failed:', error.message);
  } finally {
    await shutdownMCP();
    process.exit(0);
  }
}

main();
