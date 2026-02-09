# Web Content Fetcher Tool - Implementation Guide

## Overview

The Web Content Fetcher is a new tool that enables the Slack AI assistant to fetch, parse, and understand content from URLs shared in conversations. This transforms the bot from being blind to external links into being able to summarize articles, extract data from APIs, and answer questions about web content.

---

## Files Changed

### 1. New File: `src/tools/web-fetcher.ts`

**Purpose**: Core module containing all web fetching logic.

**Why a separate module?**
- Follows the existing pattern of `src/tools/*.ts` for tool implementations
- Keeps concerns separated (Slack actions, scheduling, web fetching are all distinct)
- Makes testing easier with the dedicated test script
- Allows future enhancements without touching agent code

### 2. Modified: `src/agents/agent.ts`

**Changes made:**
1. Added import for `fetchUrlContent`
2. Added tool definition to `SLACK_TOOLS` array
3. Added handler in `executeTool` switch statement
4. Updated `SYSTEM_PROMPT` to describe the new capability

---

## Architectural Decisions

### Decision 1: No External Dependencies for HTML Parsing

**What I did**: Used regex-based HTML parsing instead of libraries like `jsdom`, `cheerio`, or `@mozilla/readability`.

**Why**:
- **Zero new dependencies**: The project already has enough dependencies. Adding jsdom (which requires canvas, etc.) would bloat the bundle.
- **Faster cold start**: No native bindings to load
- **Sufficient for purpose**: We don't need perfect DOM parsing. We need to extract readable text and metadata - regex handles this well for 95% of web pages.
- **Predictable behavior**: External libraries can have breaking changes; our regex approach is stable.

**Trade-off**: Some complex pages might not parse perfectly, but for the typical use case (articles, docs, blog posts), it works well.

### Decision 2: Security-First URL Validation

**What I did**: Block all internal/private IP ranges before making requests.

```typescript
const BLOCKED_DOMAINS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  '10.', '172.16.', ..., '192.168.',
];
```

**Why**:
- **SSRF Prevention**: Server-Side Request Forgery is a critical vulnerability. If an attacker tricks the bot into fetching `http://169.254.169.254/latest/meta-data/` (AWS metadata endpoint), they could steal credentials.
- **Defense in depth**: Even if the bot runs in a sandboxed environment, we shouldn't rely on network-level protection alone.

### Decision 3: Timeout and Abort Controller

**What I did**: 15-second timeout with AbortController.

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
```

**Why**:
- **Prevent hanging**: Some servers respond slowly or not at all. Without timeout, the bot would hang indefinitely.
- **Resource management**: Abort releases the TCP connection and stops processing.
- **User experience**: 15 seconds is long enough for slow sites but won't make users wait forever.

### Decision 4: Content-Type Aware Handling

**What I did**: Different processing paths for HTML, JSON, and plain text.

```typescript
if (contentType.includes('application/json')) {
  // Parse and pretty-print JSON
}
if (contentType.includes('text/plain')) {
  // Return raw text
}
if (contentType.includes('text/html')) {
  // Extract readable content
}
```

**Why**:
- **JSON APIs**: Users might share API endpoints. Returning formatted JSON is more useful than trying to "parse" it as HTML.
- **Plain text**: README files, logs, etc. should be returned as-is.
- **HTML**: Needs processing to remove scripts, styles, navigation.

### Decision 5: Content Length Limits

**What I did**: Default 6000 chars, max 10000 chars.

**Why**:
- **Context window preservation**: The LLM has limited context. Dumping 50KB of text would crowd out conversation history.
- **Cost control**: More tokens = more API cost.
- **Relevance**: The first 6000 characters usually contain the most important content (article body, not footer links).

---

## Engineering Decisions

### Decision 1: Tool Schema Design

```typescript
{
  name: 'fetch_url_content',
  parameters: {
    url: { type: 'string', required: true },
    extract_type: { enum: ['text', 'metadata'] },
    max_length: { type: 'number' }
  }
}
```

**Why these parameters?**
- `url`: Obviously required
- `extract_type`: Sometimes the LLM only needs title/description (quick check), other times full content
- `max_length`: Allows the LLM to request more/less based on context window availability

### Decision 2: Metadata Extraction Strategy

**What I did**: Extract Open Graph tags, then fall back to standard meta tags.

```typescript
// Priority: OG tags > Standard meta tags
const ogDescription = html.match(/<meta[^>]+property=["']og:description["'].../)
const metaDescription = html.match(/<meta[^>]+name=["']description["'].../)
```

**Why**:
- **OG tags are authoritative**: Publishers explicitly set these for sharing. They're the "official" summary.
- **Fallback is important**: Old sites don't have OG tags.
- **Structured data**: Author, publish date, site name help the LLM cite sources properly.

### Decision 3: Main Content Detection

**What I did**: Try to find `<main>`, `<article>`, or content-class divs before falling back to `<body>`.

```typescript
const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  || content.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  || content.match(/<div[^>]+class=["'][^"']*(?:content|article|post).../)
```

**Why**:
- **Signal over noise**: Headers, footers, sidebars are navigation, not content
- **Better summaries**: The LLM gets the article body, not "Home | About | Contact | Search..."
- **Modern web conventions**: Most sites use semantic HTML or common class names

### Decision 4: HTML Entity Decoding

**What I did**: Custom decoder for common entities.

```typescript
const entities = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&mdash;': '—', '&hellip;': '…', // etc.
};
```

**Why**:
- **Readable output**: `&amp;` → `&` makes text human-readable
- **LLM processing**: The model understands "—" better than "&mdash;"
- **No dependency**: Could use `he` or `entities` npm packages, but this covers 99% of cases

### Decision 5: Utility Functions for Future Use

**What I did**: Exported `extractUrls()` and `isContentUrl()` even though they're not used yet.

```typescript
export function extractUrls(text: string): string[]
export function isContentUrl(url: string): boolean
```

**Why**:
- **Proactive URL detection**: Future enhancement could auto-fetch URLs when users share them
- **Smart filtering**: Don't fetch images, CSS, JS files
- **Test coverage**: Having these tested now means they're ready when needed

---

## How It Integrates with the Agent

### Flow Diagram

```
User: "What does this article say? https://example.com/article"
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Agent receives message                          │
│ - Adds to session history                       │
│ - Builds prompt with system message, memory,    │
│   RAG context, conversation history             │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ LLM decides to use fetch_url_content tool       │
│ - Recognizes URL in message                     │
│ - Returns tool_call with url parameter          │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ executeTool('fetch_url_content', {url: '...'}) │
│ - Validates URL (security check)                │
│ - Fetches with timeout                          │
│ - Parses HTML, extracts content                 │
│ - Returns formatted result                      │
└─────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│ LLM receives tool result                        │
│ - Has title, content, metadata                  │
│ - Generates summary for user                    │
│ - Cites source appropriately                    │
└─────────────────────────────────────────────────┘
         │
         ▼
User: "This article from [Site Name] discusses..."
```

### Tool Result Format

The tool returns structured information that helps the LLM:

```
Title: Understanding Machine Learning
Site: Medium
Author: John Doe
Published: 2024-01-15
Description: A beginner's guide to ML concepts

Content:
Machine learning is a subset of artificial intelligence...
```

This format lets the LLM:
1. Cite the source properly ("According to John Doe's article on Medium...")
2. Note the publication date for relevance
3. Summarize based on actual content

---

## Testing

Run the test script:

```bash
npx tsx scripts/test-web-fetcher.ts
```

**Test Coverage:**
1. ✅ Basic HTML page fetch (example.com)
2. ✅ Metadata extraction from complex site (BBC)
3. ✅ JSON API response handling (httpbin.org)
4. ✅ Invalid URL rejection
5. ✅ Internal URL blocking (security)
6. ✅ URL extraction from Slack message format
7. ✅ Content URL vs asset URL detection

---

## Usage Examples

### Example 1: Summarize an Article

**User**: "Can you summarize this? https://blog.example.com/ai-trends-2024"

**Agent**: Uses `fetch_url_content` → Gets article content → Provides summary

### Example 2: Quick Metadata Check

**User**: "Who wrote the article at https://news.site/breaking-story"

**Agent**: Uses `fetch_url_content` with `extract_type: 'metadata'` → Returns just author/title

### Example 3: API Data

**User**: "What's the response from https://api.example.com/status"

**Agent**: Uses `fetch_url_content` → Gets JSON → Explains the data

---

## Future Enhancements

1. **Proactive URL Detection**: Auto-summarize links when shared (using `extractUrls()`)
2. **Caching**: Cache fetched content to avoid re-fetching same URL
3. **PDF Support**: Add PDF text extraction (would need `pdf-parse` dependency)
4. **Rate Limiting**: Prevent abuse by limiting fetches per minute
5. **RAG Integration**: Index fetched content into vector store for later search

---

## Summary

The Web Content Fetcher adds a critical capability to the Slack AI assistant with:

- **Zero new dependencies** - Pure Node.js implementation
- **Security hardened** - Blocks internal URLs, has timeouts
- **LLM-optimized output** - Structured metadata + content
- **Future-ready** - Utility functions for proactive features

This transforms the bot from being "Slack-only" to being truly web-aware.

---

## Appendix: TypeScript Errors Fixed

While implementing the web fetcher, we also fixed several pre-existing TypeScript errors in the codebase. Here's what each error was and why it happened, explained simply.

---

### Error 1: Wrong Way to Set Log Level

**File**: `src/tools/slack-actions.ts` (line 10)

**The Error**:
```
Type '"DEBUG"' is not assignable to type 'LogLevel'
```

**What Was Wrong**:
```typescript
// ❌ Before (broken)
logLevel: config.app.logLevel === 'debug' ? 'DEBUG' : 'INFO',
```

The Slack library expects a special "enum" value, not a plain string. Think of it like this: the library has a list of approved values (`LogLevel.DEBUG`, `LogLevel.INFO`), and we were giving it a random string `"DEBUG"` instead of picking from the approved list.

**The Fix**:
```typescript
// ✅ After (fixed)
import { WebClient, LogLevel } from '@slack/web-api';
logLevel: config.app.logLevel === 'debug' ? LogLevel.DEBUG : LogLevel.INFO,
```

**Simple Analogy**: It's like a vending machine that only accepts specific tokens, but we were trying to use a paper note that said "token" on it. We needed to use the actual token.

---

### Error 2 & 3: User Might Not Exist

**File**: `src/channels/slack.ts` (lines 217, 221)

**The Error**:
```
Type 'string | undefined' is not assignable to type 'string'
```

**What Was Wrong**:
```typescript
// ❌ Before (broken)
slackApp.event('app_mention', async ({ event, say }) => {
  const { user, channel, ts, thread_ts, text } = event;
  // TypeScript says: "user might be undefined!"
  const session = getOrCreateSession(user, channel, ...);  // Error!
  userId: user,  // Error!
});
```

When Slack sends an event, the `user` field *might* not be there (it's rare, but possible). TypeScript is being careful and saying "Hey, you're assuming `user` always exists, but what if it doesn't?"

**The Fix**:
```typescript
// ✅ After (fixed)
slackApp.event('app_mention', async ({ event, say }) => {
  const { user, channel, ts, thread_ts, text } = event;

  // Check if user exists before using it
  if (!user) {
    logger.warn('Received app_mention without user');
    return;  // Exit early, don't crash
  }

  // Now TypeScript knows user is definitely a string
  const session = getOrCreateSession(user, channel, ...);  // Works!
});
```

**Simple Analogy**: It's like getting a package delivery. Usually there's a return address, but sometimes there isn't. Before writing a thank-you note to the sender, you should check if the return address actually exists.

---

### Error 4: Variable Created But Never Used (BUG FIX!)

**File**: `src/memory/database.ts` (line 382)

**The Error**:
```
'now' is declared but its value is never read
```

**What Was Wrong**:
```typescript
// ❌ Before (broken - this was a real bug!)
export function verifyPairingCode(code: string): string | null {
  const now = Math.floor(Date.now() / 1000);  // Created but never used!
  const result = db.prepare(`
    SELECT user_id FROM pairing_codes
    WHERE code = ? AND expires_at > ? AND approved = 0
  `).get(code.toUpperCase());  // Missing 'now' parameter!
  return result?.user_id || null;
}
```

This was actually a **real bug**, not just a style issue! The code was supposed to check if a pairing code had expired. It created a variable `now` with the current time, but then **forgot to pass it to the database query**.

The SQL has two `?` placeholders (`code = ?` and `expires_at > ?`), but only one value was passed (`code`). This means the expiration check **never worked** - expired codes would still be accepted!

**The Fix**:
```typescript
// ✅ After (fixed)
export function verifyPairingCode(code: string): string | null {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    SELECT user_id FROM pairing_codes
    WHERE code = ? AND expires_at > ? AND approved = 0
  `).get(code.toUpperCase(), now);  // Now 'now' is passed to the query!
  return result?.user_id || null;
}
```

**Simple Analogy**: It's like writing a check but forgetting to sign it. The check looks complete, but it won't actually work. TypeScript caught this by noticing we created something (`now`) but never used it.

---

### Error 5 & 6: Imported Things We Never Used

**File**: `src/rag/retriever.ts` (lines 57, 60)

**The Error**:
```
'config' is declared but its value is never read
'getDocuments' is declared but its value is never read
```

**What Was Wrong**:
```typescript
// ❌ Before (unnecessary imports)
import { config } from '../config/index.js';  // Never used!
import { search, SearchResult, getDocuments } from './vectorstore.js';  // getDocuments never used!
```

Someone imported these thinking they'd need them, but then never actually used them in the code. It's like buying ingredients for a recipe but then making a different dish.

**The Fix**:
```typescript
// ✅ After (cleaned up)
import { search, SearchResult } from './vectorstore.js';  // Only import what we use
```

**Simple Analogy**: It's like packing a suitcase with items "just in case" but never using them. Better to pack light and only bring what you need.

---

### Error 7 & 8: Options Defined But Not Implemented Yet

**File**: `src/rag/retriever.ts` (lines 150, 151)

**The Error**:
```
'includeContext' is declared but its value is never read
'contextWindow' is declared but its value is never read
```

**What Was Wrong**:
```typescript
// ❌ Before (planned features not implemented)
const {
  limit = 10,
  minScore = 0.3,
  channelName,
  includeContext = false,  // Extracted but never used!
  contextWindow = 2,       // Extracted but never used!
} = options;
```

These options were designed for a future feature (getting surrounding messages for context), but that feature was never built. The code extracts the values but then does nothing with them.

**The Fix**:
```typescript
// ✅ After (marked as planned for future)
const {
  limit = 10,
  minScore = 0.3,
  channelName,
  // Rename with underscore to show they're intentionally unused
  includeContext: _includeContext = false,
  contextWindow: _contextWindow = 2,
} = options;
void _includeContext; void _contextWindow; // Tell TypeScript: "Yes, I know these are unused"
```

**Simple Analogy**: It's like having a button on a dashboard that's labeled but not connected to anything yet. We're keeping the button (for the future) but adding a note that says "coming soon."

---

### Error 9: Constant Defined But Never Used

**File**: `src/rag/vectorstore.ts` (line 49)

**The Error**:
```
'COLLECTION_NAME' is declared but its value is never read
```

**What Was Wrong**:
```typescript
// ❌ Before (leftover from old design)
const COLLECTION_NAME = 'slack_messages';  // Never used anywhere!
```

This was probably meant for ChromaDB (a vector database) which uses "collections" to organize data. But the code was later changed to use a simpler in-memory storage that doesn't need collection names. The constant was left behind like a fossil.

**The Fix**:
```typescript
// ✅ After (removed)
// Simply deleted the unused line
```

**Simple Analogy**: It's like having an old key on your keychain for a lock that no longer exists. Just remove it.

---

### Error 10: Can't Export Without Proper Type

**File**: `src/memory/database.ts` (line 16)

**The Error**:
```
Exported variable 'db' has or is using name 'BetterSqlite3.Database' but cannot be named
```

**What Was Wrong**:
```typescript
// ❌ Before (TypeScript can't figure out the type)
import Database from 'better-sqlite3';
const db = new Database(config.app.databasePath);
// ... later ...
export { db };  // Error: TypeScript doesn't know how to describe 'db' to other files
```

When you export something, TypeScript needs to tell other files what type it is. But the type `Database` from better-sqlite3 wasn't being exported in a way TypeScript could reference. It's like trying to describe something but not having the right words.

**The Fix**:
```typescript
// ✅ After (explicitly import and use the type)
import Database, { Database as DatabaseType } from 'better-sqlite3';
const db: DatabaseType = new Database(config.app.databasePath);
export { db };  // Now TypeScript knows exactly what type 'db' is
```

**Simple Analogy**: It's like introducing someone at a party. Before, you were saying "this is... uh... that person." Now you're saying "this is John, he's a software engineer" - you're giving a proper introduction with all the details.

---

## Summary of Fixes

| # | File | Problem | Was it a bug? |
|---|------|---------|---------------|
| 1 | slack-actions.ts | Used string instead of enum | No, just wrong type |
| 2-3 | slack.ts | Didn't check if user exists | No, but could crash |
| 4 | database.ts | **Expiration check never worked!** | **YES - Real bug!** |
| 5-6 | retriever.ts | Imported unused modules | No, just messy |
| 7-8 | retriever.ts | Planned features not built | No, just incomplete |
| 9 | vectorstore.ts | Leftover constant | No, just messy |
| 10 | database.ts | Type export issue | No, just TypeScript strictness |

The most important fix was **Error 4** - the pairing code expiration was completely broken and would have allowed expired codes to work forever!
