# Openclaw-mini Architecture

## Overview

This Slack assistant implements advanced AI features:

1. **RAG (Retrieval Augmented Generation)** - Semantic search over Slack message history
2. **Memory System** - Implemented with mem0 (memo) for long-term and short-term user memory
3. **MCP (Model Context Protocol)** - Standardizes tool servers

Each feature is implemented with a clear purpose and real-world application in mind.

---

## RAG (Retrieval Augmented Generation)

### The Problem

A Slack workspace could have 2 years of conversation across 50 channels. With traditional keyword search:
- You need to know the exact words used
- Relevant discussions are easily missed

### The Solution

RAG understands the **meaning** of the question through semantic search and finds semantically similar content even if different words were used.

### Real-World Examples

| Scenario | Without RAG (Keyword Search) | With RAG (Semantic Search) |
|----------|------------------------------|----------------------------|
| "What did we decide about the pricing?" | Searches for "decide" + "pricing" literally | Finds discussions about cost structure, rate changes, fee adjustments |
| Finding customer complaints | Searches for "complaints" only | Finds "issues", "problems", "unhappy customers", "bugs reported", etc. |

---

## RAG Pipeline

### 1. Indexing (Background Process)

```
Slack Messages → Chunking → OpenAI Embedding Model → ChromaDB (Vector Database)
```

- Take messages from Slack
- Chunk them into smaller pieces
- Convert chunks into vectors using OpenAI embedding model
- Store vectors in ChromaDB

### 2. Retrieval (Query Time)

```
User Query → Embedding → Similarity Search → Top-N Results
```

- Convert user query into an embedding
- Execute similarity search (cosine similarity)
- Return vectors with highest similarity from ChromaDB

### 3. Generation

```
Query + Context (Top-N Results) → GPT-4 → Answer
```

- Pass query plus retrieved context to the LLM (GPT-4)
- Produce the final answer

---

---

## Implementation Details

### Vector Database: ChromaDB

Why ChromaDB?
- **Local** - No external dependencies
- **Persistent storage** - Data survives restarts
- **Good performance** - Optimized for small to medium datasets
- **Easy setup** - Minimal configuration required

### Embedding Model: OpenAI Embedding 3 Small

- Good balance of quality and cost
- Cost: ~$0.00002 per 1,000 tokens

### Chunking Strategy

Each Slack message = one chunk (natural boundaries)

**Preserved Metadata:**
- Channel
- User
- Timestamp
- Thread
- Context

### Context Window

Include **2 messages before and after** for context.

### Indexing Schedule

Background jobs run **every hour**:
- Index new messages since last run
- Re-index edited messages

---

## Memory System

### The Problem with Current Chatbots

Current chatbots forget everything between sessions:
- Every conversation starts fresh
- Users have to repeat preferences every time
- No personalization
- Context from previous conversations is lost
- No learning - chatbot doesn't learn about user over time

**We want to change that.**

### Memory Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Memory System                      │
├─────────────────────┬───────────────────────────────┤
│   Short-Term Memory │       Long-Term Memory        │
│  (Current Session)  │    (Persistent Knowledge)     │
├─────────────────────┼───────────────────────────────┤
│ • Last 10-20 msgs   │ • User preferences            │
│ • Current tasks     │ • Past projects & decisions   │
│ • Active goals      │ • Relationships (who works    │
│ • Active entities   │   with whom)                  │
│   (people, topics)  │ • Communication style prefs   │
│                     │ • Technical expertise level   │
├─────────────────────┼───────────────────────────────┤
│ Cleared after       │ Persists across sessions      │
│ session ends        │                               │
└─────────────────────┴───────────────────────────────┘
```

### Short-Term Memory

- Stores last 10-20 messages
- Remembers current tasks or goals
- Tracks active entities (people, topics)
- **Cleared after session ends**

### Long-Term Memory

- User preferences
- Past projects and decisions
- Relationships (who works with whom)
- Communication style preferences
- Technical expertise level
- **Persists across sessions** - This is the most important thing

---

## Memory Types & Real-World Applications

| Memory Type | What It Stores | Real-World Application |
|-------------|----------------|------------------------|
| **Preferences** | User prefers concise answers | Adapts communication style automatically |
| **Context** | User is working on Q4 launch | Understands project references without explanation |
| **Relationships** | User collaborates with Udbhav on design | Provides better, more relevant suggestions |
| **Expertise** | User is a senior AI engineer | Adjusts technical depth appropriately |
| **History** | Previous conversations | Maintains continuity across sessions |

---

## How mem0 Works

mem0 (memo) provides intelligent memory management through four key processes:

### 1. Automatic Memory Extraction

LLM extracts facts from conversations automatically.

### 2. Memory Consolidation

Merges and updates existing memories - no duplicates, always current.

### 3. Semantic Retrieval

Finds relevant memories for context using semantic search.

### 4. Memory Decay

Old or unused memories naturally fade over time. Memories are stored in **JSON format**.

```
Conversation → LLM Extraction → Consolidation → Storage (JSON)
                                    ↑
                            Semantic Retrieval
                                    ↓
                              Memory Decay
```

---

## MCP (Model Context Protocol)

### The Problem

Every AI application implements tools differently:
- **OpenAI** uses function calling
- **Anthropic** uses tool use
- **LangChain** has its own format

Each integration becomes custom code. No standardization.

### The Solution

**MCP** is a standard protocol for connecting LLMs to tools, data sources, and capabilities.

### Benefits of MCP

| Benefit | Description |
|---------|-------------|
| **Reusability** | Write once, use with any MCP-compatible LLM |
| **Standardization** | Common interface for all tools |
| **Separation of Concerns** | Tools are independent servers |
| **Community Tools** | Leverage community-built MCP servers |
| **Security** | Control access to capabilities |

---

## MCP Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Host / Client                         │
│                     (Assistant Application)                      │
│                                                                  │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│    │ Claude/GPT   │  │   LLM Core   │  │   Context    │        │
│    └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────┬───────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  MCP Server   │    │  MCP Server   │    │  MCP Server   │
│    Memory     │    │     RAG       │    │    Slack      │
├───────────────┤    ├───────────────┤    ├───────────────┤
│  mem0 Store   │    │   ChromaDB    │    │   Slack API   │
│    (JSON)     │    │   Vectors     │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
```

### What MCP Servers Expose

Each MCP server exposes three types of capabilities:

| Type | Description | Example |
|------|-------------|---------|
| **Tools** | Actions the LLM can take | Send message, search |
| **Resources** | Data the LLM can read | Channel info, user data |
| **Prompts** | Predefined prompt templates | Search template |

### Slack MCP Server Example

**Tools:**
- `send_message` - Send a message to a channel
- `get_channel_history` - Retrieve channel message history
- `search_messages` - Search across messages

**Resources:**
- Slack channels list
- Channel descriptions
- User information

---

## Implementation Roadmap

### Phase 1: RAG System

1. Set up ChromaDB for vector storage
2. Create embedding pipeline for Slack messages
3. Implement semantic search tool
4. Add knowledge base query capability
5. Set up background indexing job

### Phase 2: Memory System

1. Integrate mem0 library
2. Implement short-term conversation memory
3. Implement long-term user memory
4. Add memory-aware context injection
5. Add memory management tools (view, delete, etc.)

### Phase 3: MCP Servers

1. Create Slack MCP server
2. Create Memory MCP server
3. Create RAG MCP server
4. Update main agent to use MCP
5. Add documentation for extending

---

## Project Structure

```
openclaw-mini/
├── src/
│   ├── agents/
│   │   └── agent.ts              # Main AI agent
│   │
│   ├── rag/
│   │   ├── embeddings.ts         # OpenAI embeddings
│   │   ├── vector-store.ts       # ChromaDB vector store
│   │   ├── indexer.ts            # Background indexing
│   │   └── retriever.ts          # Semantic retrieval
│   │
│   ├── memory/
│   │   ├── memo-client.ts        # mem0 client integration
│   │   ├── short-term.ts         # Session memory
│   │   └── long-term.ts          # Persistent memory
│   │
│   ├── mcp/
│   │   ├── slack-server.ts       # Slack MCP server
│   │   ├── memory-server.ts      # Memory MCP server
│   │   └── rag-server.ts         # RAG MCP server
│   │
│   ├── tools/
│   │   └── slack-actions.ts      # Slack API operations
│   │
│   └── index.ts                  # Entry point
│
└── docs/
    └── ARCHITECTURE.md           # This file
```
