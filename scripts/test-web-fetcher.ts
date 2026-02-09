/**
 * Test script for the Web Content Fetcher tool
 *
 * Run with: npx tsx scripts/test-web-fetcher.ts
 */

import { fetchUrlContent, extractUrls, isContentUrl } from '../src/tools/web-fetcher.js';

async function main() {
  console.log('=== Web Content Fetcher Test ===\n');

  // Test 1: Fetch a simple webpage
  console.log('Test 1: Fetching example.com...');
  const result1 = await fetchUrlContent('https://example.com');
  console.log('Success:', result1.success);
  console.log('Title:', result1.title);
  console.log('Content length:', result1.content?.length || 0);
  console.log('---\n');

  // Test 2: Fetch with metadata only
  console.log('Test 2: Fetching metadata from a news site...');
  const result2 = await fetchUrlContent('https://www.bbc.com', {
    extractType: 'metadata',
  });
  console.log('Success:', result2.success);
  console.log('Title:', result2.title);
  console.log('Metadata:', result2.metadata);
  console.log('---\n');

  // Test 3: Fetch JSON endpoint
  console.log('Test 3: Fetching JSON from an API...');
  const result3 = await fetchUrlContent('https://httpbin.org/json');
  console.log('Success:', result3.success);
  console.log('Content type:', result3.contentType);
  console.log('Content preview:', result3.content?.slice(0, 200));
  console.log('---\n');

  // Test 4: Invalid URL
  console.log('Test 4: Testing invalid URL...');
  const result4 = await fetchUrlContent('not-a-url');
  console.log('Success:', result4.success);
  console.log('Error:', result4.error);
  console.log('---\n');

  // Test 5: Blocked internal URL
  console.log('Test 5: Testing blocked internal URL...');
  const result5 = await fetchUrlContent('http://localhost:3000');
  console.log('Success:', result5.success);
  console.log('Error:', result5.error);
  console.log('---\n');

  // Test 6: Extract URLs from text
  console.log('Test 6: Extracting URLs from Slack message...');
  const slackMessage = 'Check out this article <https://example.com/article|Click here> and also https://another.com/page';
  const urls = extractUrls(slackMessage);
  console.log('Found URLs:', urls);
  console.log('---\n');

  // Test 7: Check content URL detection
  console.log('Test 7: Content URL detection...');
  const testUrls = [
    'https://example.com/article',
    'https://example.com/image.png',
    'https://example.com/script.js',
    'https://example.com/page.html',
  ];
  for (const url of testUrls) {
    console.log(`${url} -> isContentUrl: ${isContentUrl(url)}`);
  }
  console.log('---\n');

  console.log('=== All tests completed ===');
}

main().catch(console.error);
