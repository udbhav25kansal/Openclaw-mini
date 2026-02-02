# MCP Integration - GitHub & Notion

## Overview

**Model Context Protocol (MCP)** is Anthropic's open standard for connecting AI to external tools. This integration lets your Slack bot interact with GitHub and Notion.

---

## Setup

### 1. GitHub Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Generate a new token
3. Set up scopes (repo, read:org, etc.)
4. Copy the token
5. Add to `.env`:

```env
GITHUB_TOKEN=ghp_your_token_here
```

### 2. Notion Token

1. Go to [notion.so/my-integrations](https://notion.so/my-integrations)
2. Click on your integration name
3. Copy the internal integration token
4. **Important:** Share pages/databases with integration:
   - Open the page in Notion
   - Click "Add connections"
   - Select your integration
5. Add to `.env`:

```env
NOTION_TOKEN=secret_your_token_here
```

---

## Architecture

```
┌─────────────────┐
│  User Message   │
└────────┬────────┘
         ↓
┌─────────────────┐
│     Agent       │
└────────┬────────┘
         ↓
┌─────────────────────────────────────────────┐
│                   Tools                      │
├─────────────┬─────────────┬─────────────────┤
│ Slack Tool  │ MCP Client  │   MCP Client    │
│ (Built-in)  │  (GitHub)   │   (Notion)      │
│             │             │                 │
│             │ Extensible to any MCP server  │
└─────────────┴─────────────┴─────────────────┘
```