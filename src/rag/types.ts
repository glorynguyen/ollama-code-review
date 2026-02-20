/**
 * F-009: RAG-Enhanced Reviews
 * Type definitions for the RAG (Retrieval-Augmented Generation) system.
 */

export interface RagConfig {
  /** Enable RAG-enhanced reviews */
  enabled: boolean;
  /** Index workspace files on startup (background) */
  indexOnStartup: boolean;
  /** Ollama model to use for embeddings (e.g. "nomic-embed-text") */
  embeddingModel: string;
  /** Maximum number of similar code chunks to retrieve per review */
  maxResults: number;
  /** Minimum cosine similarity score for a chunk to be included (0-1) */
  similarityThreshold: number;
  /** File glob patterns to include when indexing */
  includeGlob: string;
  /** File glob patterns to exclude when indexing */
  excludeGlob: string;
  /** Maximum chunk size in characters */
  chunkSize: number;
  /** Overlap between consecutive chunks in characters */
  chunkOverlap: number;
}

export interface CodeChunk {
  /** Unique identifier */
  id: string;
  /** Relative file path in the workspace */
  filePath: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** The code text content */
  content: string;
  /** Embedding vector (empty until indexed) */
  embedding: number[];
  /** When this chunk was last indexed (ISO string) */
  indexedAt: string;
}

export interface VectorStore {
  /** Index file format version */
  version: number;
  /** When the index was last updated */
  updatedAt: string;
  /** Total number of indexed chunks */
  chunkCount: number;
  /** Map from chunk ID to CodeChunk */
  chunks: Record<string, CodeChunk>;
}

export interface RetrievalResult {
  chunk: CodeChunk;
  /** Cosine similarity score (0-1) */
  score: number;
}

export interface RagContext {
  /** Retrieved chunks sorted by relevance */
  results: RetrievalResult[];
  /** Human-readable summary */
  summary: string;
}

export interface IndexingStats {
  filesIndexed: number;
  chunksCreated: number;
  filesSkipped: number;
  durationMs: number;
}

export const DEFAULT_RAG_CONFIG: RagConfig = {
  enabled: false,
  indexOnStartup: false,
  embeddingModel: 'nomic-embed-text',
  maxResults: 5,
  similarityThreshold: 0.65,
  includeGlob: '**/*.{ts,js,tsx,jsx,py,java,cs,go,rb,php,rs,swift,kt,vue,svelte}',
  excludeGlob: '**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/coverage/**,**/*.min.js,**/*.d.ts',
  chunkSize: 1500,
  chunkOverlap: 150,
};
