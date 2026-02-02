# RAG (Retrieval Augmented Generation) Implementation

## What is RAG?

RAG is a technique that enhances LLM responses by retrieving relevant information from a knowledge base (in this case, Slack) before generating an answer.

Instead of relying solely on model training data, RAG **grounds** responses in your actual data.

---

## Traditional LLM vs RAG-Enhanced LLM

### Traditional LLM

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Question   │  →   │     LLM      │  →   │    Answer    │
└──────────────┘      └──────────────┘      └──────────────┘
                              ↑
                      Training Data Only
```

- User asks a question
- LLM processes using only its training data
- Answer is limited to what the model learned during training

### RAG-Enhanced LLM

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Question   │  →   │   Retrieve   │  →   │   Relevant   │
└──────────────┘      │   Documents  │      │   Documents  │
                      └──────────────┘      └──────┬───────┘
                                                   │
                                                   ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│    Answer    │  ←   │     LLM      │  ←   │ Query + Docs │
└──────────────┘      └──────────────┘      │  (Context)   │
                                            └──────────────┘
```

- User inputs a question
- System retrieves relevant documents from knowledge base
- Query + relevant documents passed to LLM as context
- LLM generates answer grounded in actual data

---

## Why RAG for Slack?

### The Knowledge Problem

A Slack workspace contains valuable institutional knowledge:

| Type | Example |
|------|---------|
| **Decisions** | Why we chose PostgreSQL over MongoDB |
| **Processes** | How we deploy to production |
| **History** | What happened with the outage last month |
| **Expertise** | Who knows what in the team |

**The problem:**
- Knowledge is scattered across channels
- Buried in old messages
- Hard to search with keyword search
- Lost when people leave

### The Solution with RAG

RAG transforms Slack history into a searchable knowledge base.

| | Before RAG | After RAG |
|---|------------|-----------|
| **Search** | Keyword search only | Semantic understanding |
| **Results** | Missed relevant results | Finds conceptually similar content |
| **Answers** | No context | Answers cite specific messages |
| **Effort** | Manual searching | AI finds relevant information automatically |

---

## RAG Architecture Components

### 1. Indexing Pipeline (Background Process)

```
┌───────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Slack API │ →  │   Message   │ →  │   Create    │ →  │  Store as   │
│           │    │   Fetcher   │    │ Embeddings  │    │  Vectors    │
└───────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### 2. Retrieval Pipeline (Query Time)

```
┌───────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   User    │ →  │    Embed    │ →  │   Vector    │ →  │  Re-rank    │
│   Query   │    │    Query    │    │   Search    │    │  Results    │
└───────────┘    └─────────────┘    │ (Similarity)│    └─────────────┘
                                    └─────────────┘
```

### 3. Generation Pipeline (Answer Time)

```
┌─────────────────────┐    ┌───────────┐    ┌─────────────────┐
│  Query + Context    │ →  │    LLM    │ →  │ Answer + Citations│
│  (Retrieved Docs)   │    │  (GPT-4)  │    │                 │
└─────────────────────┘    └───────────┘    └─────────────────┘

---

## Technology Choices

| Component | Choice | Reason |
|-----------|--------|--------|
| **Vector DB** | ChromaDB | Local, easy to set up, good for small-medium scale |
| **Embeddings** | OpenAI Text Embedding 3 Small | High quality, cost effective |
| **LLM** | GPT-4 | Good reasoning for RAG |

---

## Implementation Details

### 1. Embeddings Module (`src/rag/embeddings.ts`)

Converts text into vector representations.

```
"The deployment failed due to memory issues"
                    ↓
            OpenAI Embedding API
                    ↓
    [0.023, -0.041, 0.018, ...] (1536 dimensions)
```

**Key principle:** Similar meanings = Similar vectors

### 2. Vector Store (`src/rag/vector-store.ts`)

Stores messages with their embeddings and metadata.

```typescript
{
  messageId: "msg_123",
  text: "After comparing options, we chose ChromaDB for persistence",
  embedding: [0.023, -0.041, ...],
  metadata: {
    channel: "#engineering",
    user: "udbhav",
    timestamp: "2024-01-15T10:30:00Z"
  }
}
```

Enables searching for similar messages based on vector similarity.

### 3. Indexer (`src/rag/indexer.ts`)

Background job that runs **every hour** to:
- Fetch new messages from Slack
- Create embeddings
- Store in vector database

### 4. Retriever (`src/rag/retriever.ts`)

Semantic search with reranking:

1. **Embed Query** - Create embedding from incoming query
2. **Find Similar Documents** - Vector similarity search
3. **Rerank by Relevance** - Optional LLM-based reranking
4. **Return Top Results with Context** - Include messages before/after for context

---

## Usage Examples

### Finding Past Decisions

**Query:** "Why did we choose ChromaDB?"

```
1. Embed Query
   "ChromaDB decision" → [0.012, -0.033, ...]

2. Find Similar Messages
   → "After comparing ChromaDB and other DBs, we went with ChromaDB for its persistence..."
   → "ChromaDB allows us to persist data locally without external dependencies..."

3. LLM Synthesizes Answer with Citations
```

**Response:**
> Based on discussions in #engineering, the team chose ChromaDB for several reasons:
> - **Persistence** - "ChromaDB allows us to persist data" - @udbhav, Jan 15th
> - **No external dependencies** - "We don't need to manage a separate DB server" - @team, Jan 16th

### Finding Expertise

**Query:** "Who knows about Kubernetes?"

```
1. Search messages about Kubernetes
2. Analyze who wrote them and how detailed
3. Return expertise assessment
```

**Response:**
> Based on message history, @devops-lead has the most Kubernetes expertise,
> with 47 detailed messages about cluster management and deployments.

---

## Configuration

```typescript
{
  rag_enabled: true,
  rag_embedding_model: "text-embedding-3-small",
  rag_vector_db_path: "./data/chromadb",
  rag_index_interval: 1,        // hours
  rag_max_results: 10,
  rag_minimum_similarity: 0.7
}
```

---

## Performance Considerations

### Indexing

- **Batch embedding** - Process 100 messages at a time
- **Incremental only** - Only index new messages, not old ones
- **Rate-limited** - Respect OpenAI API limits

### Search

- **Cache frequent queries** - Avoid redundant API calls
- **Metadata filtering** - Use metadata filters before vector search
- **Limit scope** - Allow channel-specific searches

### Storage

| Scale | Recommendation |
|-------|----------------|
| < 1 million documents | ChromaDB |
| Larger scale | Pinecone or Weaviate |

### Cleanup

- Remove deleted messages from vector store

---

## Limitations

| Limitation | Description |
|------------|-------------|
| **No real-time indexing** | Messages indexed on schedule, not instantly |
| **Context window** | Can't include too many results in LLM context |
| **Quality depends on data** | Bad messages = bad retrieval |
| **Cost** | Embedding API calls cost money |
| **Privacy** | All messages are embedded and stored |

---

## Future Enhancements

- [ ] **Channel filtering** - Search within specific channels
- [ ] **Time-based filtering** - "What happened last month?"
- [ ] **User filtering** - "What did @udbhav say about X?"
- [ ] **Automatic re-indexing** - Index on message edit/delete (not just scheduled)
```
