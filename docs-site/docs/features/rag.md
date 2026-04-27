# RAG-Enhanced Reviews

Boost review quality by automatically retrieving similar code from your indexed codebase and injecting it as additional context.

## What is RAG?

**Retrieval-Augmented Generation (RAG)** is a technique that gives the AI access to your specific codebase's patterns, utility functions, and architectural conventions without needing to fit the entire repository into the model's context window.

When RAG is enabled, the extension finds existing code in your workspace that is semantically similar to the changes you're currently reviewing and provides it to the AI as a reference.

## How It Works

The RAG implementation in Ollama Code Review consists of three main phases:

### 1. Indexing (The Knowledge Base)

The extension scans your workspace and builds a local searchable index:
- **File Discovery:** Finds files matching your `includeGlob` patterns while respecting `excludeGlob` (e.g., ignoring `node_modules`).
- **Chunking:** Splits source files into overlapping segments (default: 1,500 characters with 150-character overlap) to preserve context.
- **Embeddings:** Converts each code chunk into a high-dimensional vector using an embedding model (e.g., `nomic-embed-text` via Ollama).
- **Storage:** Persists the vectors and metadata in a flat JSON store (`rag-index.json`) within the VS Code global storage directory. This approach ensures compatibility with VS Code's sandbox and avoids complex native database dependencies.

### 2. Retrieval (The Search)

When you trigger a review:
1.  **Query Generation:** The current git diff is converted into an embedding vector.
2.  **Semantic Search:** The extension performs a **Cosine Similarity** search between the diff vector and all indexed code chunks.
3.  **Filtering:** Results below the `similarityThreshold` (default: 0.65) are discarded. Snippets from files already included in the diff are also filtered out to avoid redundancy.
4.  **Ranking:** The top-K most relevant snippets are selected for the final prompt.

### 3. Augmentation (The Review)

The retrieved snippets are injected into a dedicated section of the AI prompt titled **"Related Code from Codebase"**. This allows the AI to:
- Identify if you are duplicating existing utility functions.
- Suggest usage of team-standard patterns found elsewhere in the repo.
- Catch inconsistencies with established architectural styles.

## Setup & Configuration

### Recommended Embedding Model
For the best results, we recommend using `nomic-embed-text` with local Ollama:
```bash
ollama pull nomic-embed-text
```

### Fallback Mode
If no embedding model is available, the extension automatically falls back to a lightweight **TF-IDF approximation**. While less "semantic" than deep learning embeddings, it is highly effective at finding code with similar keyword and identifier usage.

### Settings
| Setting | Description | Default |
|---------|-------------|---------|
| `rag.enabled` | Enable RAG context injection | `false` |
| `rag.indexOnStartup` | Re-index workspace in the background on launch | `false` |
| `rag.embeddingModel` | Ollama model to use for vectors | `nomic-embed-text` |
| `rag.maxResults` | Number of snippets to include in reviews | `5` |
| `rag.similarityThreshold` | Precision filter (0.0 to 1.0) | `0.65` |

## Commands

- **Ollama Code Review: Index Codebase**: Manually trigger a full re-index of the current workspace.
- **Ollama Code Review: Clear RAG Index**: Delete the local vector store to save space or force a clean rebuild.
