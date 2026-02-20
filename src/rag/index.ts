/**
 * F-009: RAG-Enhanced Reviews
 * Barrel exports for the RAG module.
 */

export * from './types';
export { JsonVectorStore } from './vectorStore';
export { indexWorkspace, indexFile, chunkText } from './indexer';
export {
  generateEmbedding,
  generateFallbackEmbedding,
  cosineSimilarity,
  isEmbeddingModelAvailable,
} from './embeddings';
export { getRagContext, retrieveRelevantChunks, buildRagContextSection } from './retriever';
export { getRagConfig } from './config';
