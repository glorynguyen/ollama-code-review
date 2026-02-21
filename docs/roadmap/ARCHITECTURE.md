# Architecture Decision Records

> **Document Version:** 3.0.0
> **Last Updated:** 2026-02-21

This document captures architectural decisions for future features. Each decision follows the ADR format for clarity and traceability.

---

## Table of Contents

- [ADR-001: Agent Architecture](#adr-001-agent-architecture)
- [ADR-002: Local vs Cloud Processing](#adr-002-local-vs-cloud-processing)
- [ADR-003: Data Storage Strategy](#adr-003-data-storage-strategy)
- [ADR-004: GitHub Integration Approach](#adr-004-github-integration-approach)
- [ADR-005: RAG Implementation](#adr-005-rag-implementation)
- [ADR-006: Provider Abstraction Layer](#adr-006-provider-abstraction-layer)
- [ADR-007: Streaming Architecture](#adr-007-streaming-architecture)
- [ADR-008: Sidebar Chat Architecture](#adr-008-sidebar-chat-architecture)

---

## ADR-001: Agent Architecture

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted (implemented in v4.2.0) |
| **Date** | 2025-01-29 |
| **Related Features** | F-007, F-008 |

### Context

The current extension performs single-pass reviews. To improve review quality, we want to implement a multi-step agentic workflow that gathers context and performs deeper analysis.

### Decision

Implement a **step-based agent orchestrator** with the following characteristics:

1. **Sequential Steps** - Each step completes before the next begins
2. **Typed Interfaces** - Clear input/output contracts between steps
3. **Interruptible** - User can cancel between steps
4. **Observable** - Progress reported to UI
5. **Fallback** - Graceful degradation if steps fail

### Architecture

```typescript
// src/agent/types.ts
interface AgentStep<TInput, TOutput> {
  name: string;
  execute(input: TInput, context: AgentContext): Promise<TOutput>;
  onProgress?(progress: number, message: string): void;
}

interface AgentContext {
  cancellationToken: CancellationToken;
  config: AgentConfig;
  cache: Map<string, unknown>;
  emit(event: AgentEvent): void;
}

// src/agent/orchestrator.ts
class AgentOrchestrator {
  private steps: AgentStep<unknown, unknown>[];

  async run(diff: string): Promise<ReviewResult> {
    let context = this.createContext();
    let state = { diff };

    for (const step of this.steps) {
      if (context.cancellationToken.isCancellationRequested) {
        throw new AgentCancelledError();
      }

      context.emit({ type: 'step-start', step: step.name });
      state = await step.execute(state, context);
      context.emit({ type: 'step-complete', step: step.name });
    }

    return state as ReviewResult;
  }
}
```

### Alternatives Considered

1. **Parallel Steps** - Rejected: Dependencies between steps make this complex
2. **Event-Driven** - Rejected: Overkill for sequential workflow
3. **Single Function** - Rejected: Hard to test and extend

### Consequences

**Positive:**
- Easy to add/remove/reorder steps
- Clear testability boundaries
- Progress tracking straightforward

**Negative:**
- Sequential execution may be slower
- State management complexity

---

## ADR-002: Local vs Cloud Processing

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted (implemented differently — see note) |
| **Date** | 2025-01-29 |
| **Updated** | 2026-02-17 |
| **Related Features** | All, S-001 |

### Context

The extension supports both local Ollama models and cloud APIs. We need a consistent strategy for handling both, including fallback behavior.

### Implementation Note (2026-02-17)

The multi-provider support was implemented in v1.10–v1.16 using **per-provider function pairs** (`isXxxModel()` + `callXxxAPI()`) in `src/extension.ts` rather than the formal `ModelProvider` interface proposed below. This works well for 7 providers but the proposed abstraction may become valuable if more providers are added or if the agent system (F-007) requires a unified interface.

### Original Decision

Implement a **provider abstraction** that unifies local and cloud processing:

```typescript
// src/providers/types.ts
interface ModelProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  generate(prompt: string, options: GenerateOptions): Promise<string>;
  chat(messages: Message[], options: ChatOptions): AsyncGenerator<string>;
  embed?(text: string): Promise<number[]>;
}

// src/providers/ollama.ts
class OllamaProvider implements ModelProvider { ... }

// src/providers/claude.ts
class ClaudeProvider implements ModelProvider { ... }

// src/providers/cloud.ts
class CloudProvider implements ModelProvider { ... }

// src/providers/index.ts
class ProviderManager {
  private providers: Map<string, ModelProvider>;

  async getProvider(modelId: string): Promise<ModelProvider> {
    const provider = this.resolveProvider(modelId);

    if (!await provider.isAvailable()) {
      return this.getFallbackProvider();
    }

    return provider;
  }
}
```

### Fallback Strategy

```
1. Try requested provider
2. If unavailable → try cloud fallback
3. If cloud unavailable → show error with setup instructions
```

### Consequences

**Positive:**
- Consistent API regardless of backend
- Easy to add new providers
- Graceful degradation

**Negative:**
- Abstraction overhead
- Provider-specific features may be hidden

---

## ADR-003: Data Storage Strategy

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted (implemented differently — JSON files, no SQLite) |
| **Date** | 2025-01-29 |
| **Updated** | 2026-02-21 |
| **Related Features** | F-009, F-011, F-012 |

### Context

Several features require persistent storage: analytics, RAG vectors, knowledge base. We need a strategy that works across platforms and respects VS Code conventions.

### Decision

Use **SQLite** for structured data and **file system** for large content:

```
~/.vscode/extensions/ollama-code-review/
├── data/
│   ├── analytics.db      # SQLite: review history, metrics
│   ├── vectors.db        # SQLite: RAG embeddings
│   └── cache/            # File system: cached responses
└── knowledge/            # File system: knowledge base entries
```

#### Storage Locations

| Data Type | Storage | Reason |
|-----------|---------|--------|
| Analytics | SQLite | Structured queries, aggregations |
| Vectors | SQLite | Efficient similarity search with extensions |
| Knowledge | Files | Git-friendly, human-readable |
| Cache | Files | Easy cleanup, size management |

#### SQLite Setup

Use `better-sqlite3` for synchronous operations (simpler in extension context):

```typescript
// src/storage/database.ts
import Database from 'better-sqlite3';

export function getDatabase(name: string): Database.Database {
  const dbPath = path.join(context.globalStoragePath, 'data', `${name}.db`);
  ensureDirectory(path.dirname(dbPath));

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // Better concurrency
  return db;
}
```

### Alternatives Considered

1. **VS Code Memento** - Rejected: Limited to JSON, poor for large data
2. **IndexedDB** - Rejected: Not available in extension host
3. **External Database** - Rejected: Adds deployment complexity

### Consequences

**Positive:**
- Full SQL capabilities
- Good performance
- No external dependencies

**Negative:**
- Binary dependency (`better-sqlite3`)
- Platform-specific builds needed

---

## ADR-004: GitHub Integration Approach

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted (implemented in v3.3.0) |
| **Date** | 2025-01-29 |
| **Related Features** | F-004, F-010, F-015 |

### Context

We need to integrate with GitHub for PR reviews. We must decide on authentication strategy and API approach.

### Decision

Support **multiple authentication methods** with graceful degradation:

#### Authentication Priority

1. **GitHub CLI (`gh`)** - Best UX, already authenticated
2. **VS Code GitHub Extension** - If user has it
3. **Personal Access Token** - Fallback, stored in settings

```typescript
// src/github/auth.ts
async function getGitHubAuth(): Promise<Octokit | null> {
  // Try GitHub CLI first
  const ghToken = await tryGetGhCliToken();
  if (ghToken) return new Octokit({ auth: ghToken });

  // Try VS Code GitHub extension
  const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
  if (session) return new Octokit({ auth: session.accessToken });

  // Fall back to stored token
  const storedToken = config.get<string>('github.token');
  if (storedToken) return new Octokit({ auth: storedToken });

  return null;
}

async function tryGetGhCliToken(): Promise<string | null> {
  try {
    const { stdout } = await exec('gh auth token');
    return stdout.trim();
  } catch {
    return null;
  }
}
```

#### Comment Posting Strategy

Map AI review findings to GitHub PR comments:

```typescript
interface ReviewFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

// Convert to GitHub review comment
function toGitHubComment(finding: ReviewFinding): ReviewComment {
  const body = finding.suggestion
    ? `${finding.message}\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``
    : finding.message;

  return {
    path: finding.file,
    line: finding.line,
    body: body,
  };
}
```

### Consequences

**Positive:**
- Seamless auth for `gh` users
- Works with existing VS Code GitHub users
- Manual token as fallback

**Negative:**
- Multiple code paths for auth
- Dependency on external tools

---

## ADR-005: RAG Implementation

| Attribute | Value |
|-----------|-------|
| **Status** | Accepted (implemented in v5.0.0 — JSON vector store, not SQLite) |
| **Date** | 2025-01-29 |
| **Updated** | 2026-02-21 |
| **Related Features** | F-009 |

### Context

To implement RAG (Retrieval-Augmented Generation), we need to decide on embedding strategy, vector storage, and retrieval approach.

### Decision

Use **local Ollama embeddings** with **SQLite vector search**:

#### Embedding Model

Use Ollama's `nomic-embed-text` model for embeddings:
- Runs locally (privacy)
- Good quality for code
- 768-dimensional vectors

```typescript
// src/rag/embeddings.ts
async function getEmbedding(text: string): Promise<number[]> {
  const response = await axios.post(`${endpoint}/api/embeddings`, {
    model: 'nomic-embed-text',
    prompt: text,
  });
  return response.data.embedding;
}
```

#### Vector Storage

Store vectors in SQLite with brute-force cosine similarity:

```sql
-- For small-medium codebases, brute force is fast enough
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  file_path TEXT,
  chunk_start INTEGER,
  chunk_end INTEGER,
  content TEXT,
  vector BLOB,  -- Stored as Float32Array
  updated_at INTEGER
);

CREATE INDEX idx_embeddings_file ON embeddings(file_path);
```

```typescript
// src/rag/vectorStore.ts
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function findSimilar(query: number[], limit = 5): Promise<SearchResult[]> {
  const all = db.prepare('SELECT * FROM embeddings').all();
  const scored = all.map(row => ({
    ...row,
    score: cosineSimilarity(query, deserializeVector(row.vector)),
  }));
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

#### Chunking Strategy

Split code into semantic chunks:

```typescript
// src/rag/chunker.ts
interface Chunk {
  content: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'block' | 'file';
}

function chunkCode(code: string, language: string): Chunk[] {
  // Use tree-sitter or simple heuristics
  // Target: 100-500 tokens per chunk
  // Overlap: 10% for context continuity
}
```

### Scaling Considerations

For large codebases (>10k files), consider:
1. **Lazy indexing** - Index on first access
2. **Incremental updates** - Only re-index changed files
3. **External vector DB** - Option to use Qdrant/Chroma

### Alternatives Considered

1. **Cloud embeddings (OpenAI)** - Rejected: Privacy, cost
2. **Dedicated vector DB** - Rejected: Extra dependency for MVP
3. **FAISS** - Rejected: Complex build, not needed for scale

### Consequences

**Positive:**
- Fully local operation
- Simple implementation
- No external services

**Negative:**
- Slower for large codebases
- Limited to available Ollama models

---

## ADR-006: Provider Abstraction Layer

| Attribute | Value |
|-----------|-------|
| **Status** | Proposed |
| **Date** | 2026-02-21 |
| **Related Features** | F-025, F-022, F-021, F-024 |

### Context

The extension has grown to 8 AI providers, each implemented as a pair of functions (`isXxxModel()` + `callXxxAPI()`) in the monolithic `extension.ts`. Adding streaming (F-022), sidebar chat (F-021), and inline edit (F-024) requires a consistent interface for generate, stream, chat, and embed operations. The current approach of adding `if/else` branches for each provider in every call site doesn't scale.

### Decision

Extract all providers into a **`ModelProvider` interface** with a **`ProviderRegistry`**:

```typescript
// src/providers/types.ts
interface ModelProvider {
  name: string;
  isMatch(model: string): boolean;
  isAvailable(): Promise<boolean>;
  generate(prompt: string, options: GenerateOptions): Promise<string>;
  stream(prompt: string, options: GenerateOptions): AsyncGenerator<string>;
  chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string>;
  embed?(text: string): Promise<number[]>;
  getMetrics(): PerformanceMetrics;
}

// src/providers/registry.ts
class ProviderRegistry {
  register(provider: ModelProvider): void;
  resolve(model: string): ModelProvider;  // throws if no match
  listAvailable(): Promise<ModelProvider[]>;
}
```

Each provider gets its own file (`src/providers/ollama.ts`, `src/providers/claude.ts`, etc.) implementing the full interface. The `generate()` method replaces today's `callXxxAPI()`. The `stream()` method is new for F-022. The `chat()` method unifies follow-up conversation support.

### Alternatives Considered

1. **Keep function pairs** — Rejected: Adding streaming requires duplicating every `callXxxAPI()` with a streaming variant, doubling the code
2. **Single generic function with strategy pattern** — Rejected: Too abstract, loses type safety for provider-specific options
3. **Use an existing LLM library (LangChain, Vercel AI SDK)** — Rejected: Adds heavy dependency, VS Code extension should stay lightweight

### Consequences

**Positive:**
- Single call site for all AI operations: `registry.resolve(model).generate(prompt)`
- Streaming, chat, and embedding become first-class operations on every provider
- New providers added by implementing one class and registering it
- Testable: each provider can be mocked independently

**Negative:**
- Initial refactor touches all command handlers
- Provider-specific quirks (HF retry on 503, Gemini's custom format) must be handled within each class

---

## ADR-007: Streaming Architecture

| Attribute | Value |
|-----------|-------|
| **Status** | Proposed |
| **Date** | 2026-02-21 |
| **Related Features** | F-022, F-021, F-024 |

### Context

All current API calls wait for the full response before displaying anything. Streaming is needed for sidebar chat (F-021) and inline edit (F-024) to feel responsive. All 8 providers support streaming via SSE or newline-delimited JSON.

### Decision

Implement streaming using **`AsyncGenerator<string>`** as the universal interface:

```typescript
// Provider implementation (example: OpenAI-compatible SSE)
async *stream(prompt: string, options: GenerateOptions): AsyncGenerator<string> {
  const response = await axios.post(url, body, {
    responseType: 'stream',
    signal: options.abortSignal,
  });

  for await (const chunk of parseSSE(response.data)) {
    yield chunk.choices[0].delta.content ?? '';
  }
}

// Consumer (webview rendering)
const generator = provider.stream(prompt, { abortSignal: controller.signal });
for await (const token of generator) {
  webview.postMessage({ type: 'stream-chunk', content: token });
}
webview.postMessage({ type: 'stream-done' });
```

The webview side uses a `StreamRenderer` that incrementally parses markdown using `marked.js` with a growing buffer and updates the DOM after each chunk (debounced to 50ms for performance).

### SSE Parsing

A shared `parseSSE()` function handles the common `data: {...}\n\n` format used by most providers. Provider-specific formats (Ollama's NDJSON, Gemini's endpoint) are handled in their respective provider classes.

### Cancellation

`AbortController` is passed to the HTTP request. When the user clicks "Stop" in the UI, `controller.abort()` cancels both the HTTP connection and the generator.

### Alternatives Considered

1. **Web Streams API (ReadableStream)** — Rejected: `AsyncGenerator` is simpler and more idiomatic in Node.js
2. **EventEmitter** — Rejected: Generators compose better and support backpressure
3. **Callback-based** — Rejected: Harder to compose, no cancellation story

### Consequences

**Positive:**
- First token visible within 500ms
- Cancellation stops HTTP request immediately
- Same interface works for sidebar chat, review panel, and inline edit

**Negative:**
- Markdown incremental rendering is tricky (partial code blocks, tables)
- Testing streaming requires mock generators

---

## ADR-008: Sidebar Chat Architecture

| Attribute | Value |
|-----------|-------|
| **Status** | Proposed |
| **Date** | 2026-02-21 |
| **Related Features** | F-021, F-023 |

### Context

The current chat is embedded in the review webview panel — it's only available after a review and disappears when the panel closes. Phase 6 requires a persistent sidebar chat that's always available, supports `@`-context mentions, and integrates with the review workflow.

### Decision

Implement the sidebar as a **`WebviewViewProvider`** (VS Code sidebar API), not a `WebviewPanel`:

```typescript
// src/chat/sidebarProvider.ts
class ChatSidebarProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.html = this.getHtml();
    view.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
  }
}

// package.json contribution
{
  "viewsContainers": {
    "activitybar": [{
      "id": "ollama-review",
      "title": "Ollama Review",
      "icon": "resources/icon.svg"
    }]
  },
  "views": {
    "ollama-review": [{
      "type": "webview",
      "id": "ollama-review.chatView",
      "name": "Chat"
    }]
  }
}
```

#### UI Technology

Start with **vanilla HTML/CSS/JS** (not React) to avoid adding a build pipeline for the webview. The review panel already uses this approach successfully. If the sidebar complexity grows, React can be introduced later.

#### State Management

- Conversation history stored in `globalState` as `ChatConversation[]`
- Each conversation has an ID, title, messages, and metadata
- Multiple conversations supported with a conversation list/selector
- Auto-title generated from first user message

#### Integration with Review Panel

The existing review panel gains a "Discuss in Chat" button that:
1. Opens the sidebar
2. Creates a new conversation with the review content as system context
3. User can ask follow-up questions in the persistent sidebar

### Alternatives Considered

1. **React + Redux sidebar** — Rejected for now: adds build complexity (bundler, dev server) for marginal benefit at current scope. Can be adopted later.
2. **Reuse review panel for chat** — Rejected: panel-based UI is transient, not persistent
3. **VS Code Chat API (`vscode.chat`)** — Considered: official API for chat extensions. However, it's still evolving and may constrain customization. Worth revisiting.

### Consequences

**Positive:**
- Persistent chat always accessible from activity bar
- Conversation history survives across sessions
- Clean separation from review panel
- Low dependency footprint (no React/Redux)

**Negative:**
- Vanilla JS for complex UI is more verbose than React
- Message passing between extension host and webview requires careful protocol design

---

## Future ADRs (Placeholder)

The following ADRs will be written as features are implemented:

- **ADR-009**: @-Context Provider Registry (F-023)
- **ADR-010**: Inline Edit Diff Rendering (F-024)
- **ADR-011**: extension.ts Decomposition Strategy (F-027)
- **ADR-012**: Testing Strategy

---

## ADR Template

```markdown
## ADR-XXX: [Title]

| Attribute | Value |
|-----------|-------|
| **Status** | Proposed / Accepted / Deprecated / Superseded |
| **Date** | YYYY-MM-DD |
| **Related Features** | F-XXX |

### Context

[Why is this decision needed?]

### Decision

[What is the decision?]

### Alternatives Considered

[What other options were evaluated?]

### Consequences

**Positive:**
- [Benefits]

**Negative:**
- [Drawbacks]
```
