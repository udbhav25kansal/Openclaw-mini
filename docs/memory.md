# Memory System - mem0 Integration

## What is mem0?

mem0 is an intelligent memory layer for AI applications. It automatically extracts, stores, and retrieves relevant facts from conversations, enabling personalized AI.

---

## Why Do We Need Memory?

### Without Memory

Every conversation starts fresh:

**Day 1:**
> **User:** I'm working on the Q4 launch project
> **Bot:** That's great!

**Day 2:**
> **User:** Any updates on my project?
> **Bot:** Which project are you referring to?

The bot forgets everything.

### With Memory

**Day 1:**
> **User:** I'm working on the Q4 launch project
> **Bot:** That's great! How can I help with that?
> *(Memory stored: "User is working on Q4 project launch")*

**Day 2:**
> **User:** Any updates on my project?
> **Bot:** I remember you're working on the Q4 launch. Let me check...

---

## Memory Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Memory System                      │
├─────────────────────┬───────────────────────────────┤
│   Short-Term Memory │       Long-Term Memory        │
│   (Session Memory)  │          (mem0)               │
├─────────────────────┼───────────────────────────────┤
│ • Recent messages   │ • User preferences            │
│ • Current task      │   - Timezone                  │
│   context           │   - Communication style       │
│                     │ • Projects working on         │
│                     │ • Technical expertise         │
│                     │ • Relationships               │
│                     │   - Who they work with        │
│                     │ • Past decisions & context    │
├─────────────────────┼───────────────────────────────┤
│ Stored in: SQLite   │ Stored in: mem0               │
│ Cleared: Session end│ Persists: Across sessions     │
└─────────────────────┴───────────────────────────────┘
```

### Short-Term Memory

- Recent conversation history
- Current task context
- **Cleared when session ends**
- Storage: SQLite

### Long-Term Memory (mem0)

- User preferences (timezone, communication style)
- Projects they're working on
- Technical expertise
- Relationships (who they work with)
- Past decisions and context
- **Persists across sessions**

---

## How mem0 Works

### 1. Automatic Fact Extraction

mem0 uses an LLM to extract facts from conversations automatically.

```
Conversation: "I prefer working late at night and use TypeScript"
                              ↓
                    LLM Fact Extraction
                              ↓
         Facts: ["User is a night owl", "User uses TypeScript"]
```

### 2. Memory Consolidation

mem0 intelligently merges and updates memories.

```
Old Memory: "User is working on payment system"
New Info:   "I'm now working on the chatbot project"
                              ↓
                   Intelligent Merge
                              ↓
Updated Memory: "User completed payment system,
                now working on chatbot project"
```

### 3. Semantic Retrieval

When you ask a question, mem0 finds relevant memories using semantic search (not keyword search).

**Query:** "What should I work on today?"

**Retrieved Memories:**
- User is working on the RAG feature
- Deadline is Thursday
- User prefers working at night (night owl)

**Bot Response:** "Based on your RAG project deadline on Thursday and your preference for night work, I'd suggest focusing on the retrieval pipeline tonight."

---

## Memory Flow Implementation

```
┌─────────────────┐
│ 1. Receive User │
│    Message      │
└────────┬────────┘
         ↓
┌─────────────────┐
│ 2. Retrieve     │ ← Get relevant memories for this user
│    Memories     │
└────────┬────────┘
         ↓
┌─────────────────┐
│ 3. Build        │ ← Add memories to system prompt
│    Context      │
└────────┬────────┘
         ↓
┌─────────────────┐
│ 4. Generate     │ ← LLM response with memory context
│    Response     │
└────────┬────────┘
         ↓
┌─────────────────┐
│ 5. Extract &    │ ← Save new facts from conversation
│    Save Memories│
└─────────────────┘
```

---

## mem0 API Configuration

```typescript
{
  memory_enabled: true,
  memo_api_key: "your-memo-api-key",  // For cloud API
  // mem0 can run locally or use cloud API
  // OpenAI is used for memory extraction
}
```

---

## Privacy Considerations

| Aspect | Implementation |
|--------|----------------|
| **User Control** | Users can ask to see or delete their memories |
| **Scope** | Memories are per user, not shared across users |
| **Retention** | Can set memory expiration policies |
| **Transparency** | Bot can explain what it remembers |

---

## Memory Tools

| Tool | Description |
|------|-------------|
| `get_my_memories` | Show what we remember about the user |
| `forget_about` | Delete specific memories |
| `remember_this` | Explicitly store something |

---

## Limitations

| Limitation | Description |
|------------|-------------|
| **Extraction Quality** | Depends on LLM quality |
| **Storage** | Local storage limited by disk space |
| **Latency** | Memory retrieval adds 100-200ms (uses OpenAI API for extraction) |