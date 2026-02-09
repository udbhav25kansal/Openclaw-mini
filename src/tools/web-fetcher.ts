/**
 * Web Content Fetcher Tool
 *
 * Fetches and extracts content from URLs, enabling the agent to
 * understand links shared in Slack conversations.
 */

import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('web-fetcher');

// ============================================
// Types
// ============================================

export interface WebFetchResult {
  success: boolean;
  url: string;
  title?: string;
  content?: string;
  metadata?: {
    description?: string;
    author?: string;
    publishedDate?: string;
    siteName?: string;
    type?: string;
    imageUrl?: string;
  };
  error?: string;
  contentType?: string;
  fetchedAt?: string;
}

export interface FetchOptions {
  extractType?: 'text' | 'summary' | 'metadata';
  maxLength?: number;
  timeoutMs?: number;
  followRedirects?: boolean;
}

// ============================================
// URL Validation
// ============================================

const BLOCKED_DOMAINS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '10.',
  '172.16.',
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.',
];

function isValidUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    // Only allow http and https
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: `Invalid protocol: ${url.protocol}. Only HTTP/HTTPS allowed.` };
    }

    // Block internal/private IPs
    const hostname = url.hostname.toLowerCase();
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostname.startsWith(blocked) || hostname === blocked) {
        return { valid: false, error: 'Cannot fetch internal/private URLs.' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

// ============================================
// HTML Parsing (lightweight, no external deps)
// ============================================

/**
 * Extract text content from HTML without external dependencies
 * Uses regex-based extraction for simplicity
 */
function extractTextFromHtml(html: string): { title: string; content: string; metadata: WebFetchResult['metadata'] } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : '';

  // Extract Open Graph and meta tags
  const metadata: WebFetchResult['metadata'] = {};

  // OG tags
  const ogDescription = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  const ogType = html.match(/<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:type["']/i);
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

  // Standard meta tags
  const metaDescription = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const metaAuthor = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']author["']/i);

  // Article published time
  const publishedTime = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i);

  if (ogDescription?.[1] || metaDescription?.[1]) {
    metadata.description = decodeHtmlEntities(ogDescription?.[1] || metaDescription?.[1] || '');
  }
  if (ogSiteName?.[1]) metadata.siteName = decodeHtmlEntities(ogSiteName[1]);
  if (ogType?.[1]) metadata.type = ogType[1];
  if (ogImage?.[1]) metadata.imageUrl = ogImage[1];
  if (metaAuthor?.[1]) metadata.author = decodeHtmlEntities(metaAuthor[1]);
  if (publishedTime?.[1]) metadata.publishedDate = publishedTime[1];

  // Extract main content
  let content = html;

  // Remove script and style tags
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ');

  // Remove header, footer, nav, aside (usually not main content)
  content = content.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ');
  content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ');
  content = content.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ');

  // Try to find main content area
  const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || content.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || content.match(/<div[^>]+class=["'][^"']*(?:content|article|post|entry|main)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

  if (mainMatch) {
    content = mainMatch[1];
  } else {
    // Fall back to body
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      content = bodyMatch[1];
    }
  }

  // Remove all HTML tags
  content = content.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  content = decodeHtmlEntities(content);

  // Clean up whitespace
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  return { title, content, metadata };
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'gi'), char);
  }

  // Handle numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
}

// ============================================
// Main Fetch Function
// ============================================

/**
 * Fetch and extract content from a URL
 */
export async function fetchUrlContent(
  url: string,
  options: FetchOptions = {}
): Promise<WebFetchResult> {
  const {
    extractType = 'text',
    maxLength = 6000,
    timeoutMs = 15000,
    followRedirects = true,
  } = options;

  logger.info(`Fetching URL: ${url}`, { extractType, maxLength });

  // Validate URL
  const validation = isValidUrl(url);
  if (!validation.valid) {
    logger.warn(`Invalid URL: ${url} - ${validation.error}`);
    return {
      success: false,
      url,
      error: validation.error,
    };
  }

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Fetch with appropriate headers
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: followRedirects ? 'follow' : 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SlackBot/1.0; +https://slack.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    clearTimeout(timeoutId);

    // Check response status
    if (!response.ok) {
      logger.warn(`HTTP error for ${url}: ${response.status} ${response.statusText}`);
      return {
        success: false,
        url,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Get content type
    const contentType = response.headers.get('content-type') || '';
    logger.info(`Content-Type: ${contentType}`);

    // Handle different content types
    if (contentType.includes('application/json')) {
      const json = await response.json();
      const content = JSON.stringify(json, null, 2);
      return {
        success: true,
        url,
        title: 'JSON Response',
        content: content.length > maxLength ? content.slice(0, maxLength) + '\n... [truncated]' : content,
        contentType: 'application/json',
        fetchedAt: new Date().toISOString(),
      };
    }

    if (contentType.includes('text/plain')) {
      const text = await response.text();
      return {
        success: true,
        url,
        title: 'Plain Text',
        content: text.length > maxLength ? text.slice(0, maxLength) + '\n... [truncated]' : text,
        contentType: 'text/plain',
        fetchedAt: new Date().toISOString(),
      };
    }

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      logger.warn(`Unsupported content type: ${contentType}`);
      return {
        success: false,
        url,
        error: `Unsupported content type: ${contentType}. Only HTML, JSON, and plain text are supported.`,
      };
    }

    // Parse HTML
    const html = await response.text();
    const { title, content, metadata } = extractTextFromHtml(html);

    logger.info(`Extracted content from ${url}: title="${title}", length=${content.length}`);

    // Handle different extract types
    if (extractType === 'metadata') {
      return {
        success: true,
        url,
        title,
        metadata,
        contentType: 'text/html',
        fetchedAt: new Date().toISOString(),
      };
    }

    // For 'text' and 'summary' modes, include content
    let finalContent = content;
    if (finalContent.length > maxLength) {
      finalContent = finalContent.slice(0, maxLength) + '\n... [truncated]';
    }

    return {
      success: true,
      url,
      title,
      content: finalContent,
      metadata,
      contentType: 'text/html',
      fetchedAt: new Date().toISOString(),
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('abort')) {
      logger.error(`Timeout fetching ${url}`);
      return {
        success: false,
        url,
        error: `Request timed out after ${timeoutMs / 1000} seconds.`,
      };
    }

    logger.error(`Error fetching ${url}: ${errorMessage}`);
    return {
      success: false,
      url,
      error: `Failed to fetch: ${errorMessage}`,
    };
  }
}

// ============================================
// URL Detection Helpers
// ============================================

/**
 * Extract URLs from text (useful for finding links in Slack messages)
 */
export function extractUrls(text: string): string[] {
  const urls: string[] = [];

  // Match Slack-formatted URLs: <https://example.com|display text> or <https://example.com>
  const slackUrlRegex = /<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g;
  let match;
  while ((match = slackUrlRegex.exec(text)) !== null) {
    urls.push(match[1]);
  }

  // Match plain URLs (if not already found)
  const plainUrlRegex = /(?<![<|])https?:\/\/[^\s<>)"']+/g;
  while ((match = plainUrlRegex.exec(text)) !== null) {
    if (!urls.includes(match[0])) {
      urls.push(match[0]);
    }
  }

  return urls;
}

/**
 * Check if a URL is likely to be a useful content page
 * (vs. an image, stylesheet, etc.)
 */
export function isContentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();

    // Skip common non-content extensions
    const skipExtensions = [
      '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
      '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.webm',
      '.zip', '.tar', '.gz', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    ];

    for (const ext of skipExtensions) {
      if (path.endsWith(ext)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

// ============================================
// Formatting Helpers
// ============================================

/**
 * Format fetch result for display in Slack
 */
export function formatFetchResultForSlack(result: WebFetchResult): string {
  if (!result.success) {
    return `❌ Failed to fetch URL: ${result.error}`;
  }

  const parts: string[] = [];

  if (result.title) {
    parts.push(`*${result.title}*`);
  }

  if (result.metadata?.siteName) {
    parts.push(`_Source: ${result.metadata.siteName}_`);
  }

  if (result.metadata?.author) {
    parts.push(`_Author: ${result.metadata.author}_`);
  }

  if (result.metadata?.publishedDate) {
    const date = new Date(result.metadata.publishedDate);
    parts.push(`_Published: ${date.toLocaleDateString()}_`);
  }

  if (result.metadata?.description) {
    parts.push(`\n> ${result.metadata.description}`);
  }

  if (result.content) {
    // Add first ~500 chars of content
    const preview = result.content.slice(0, 500);
    parts.push(`\n${preview}${result.content.length > 500 ? '...' : ''}`);
  }

  return parts.join('\n');
}
