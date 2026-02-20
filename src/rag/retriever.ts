/**
 * F-009: RAG-Enhanced Reviews
 * Retriever — finds the most relevant code chunks for a given query text.
 */

import { CodeChunk, RagConfig, RagContext, RetrievalResult } from './types';
import { JsonVectorStore } from './vectorStore';
import { generateEmbedding, generateFallbackEmbedding, cosineSimilarity } from './embeddings';

/**
 * Retrieve the top-K most relevant code chunks for a query.
 * The query is typically a portion of the diff being reviewed.
 */
export async function retrieveRelevantChunks(
  query: string,
  store: JsonVectorStore,
  config: RagConfig,
  ollamaEndpoint: string,
  useOllamaEmbeddings: boolean,
): Promise<RetrievalResult[]> {
  const allChunks = store.getAllChunks();
  if (allChunks.length === 0) {
    return [];
  }

  // Generate query embedding
  let queryEmbedding: number[];
  if (useOllamaEmbeddings) {
    const ollamaEmb = await generateEmbedding(query, config.embeddingModel, ollamaEndpoint);
    queryEmbedding = ollamaEmb ?? generateFallbackEmbedding(query);
  } else {
    queryEmbedding = generateFallbackEmbedding(query);
  }

  // Score all chunks
  const scored: RetrievalResult[] = [];
  for (const chunk of allChunks) {
    if (!chunk.embedding || chunk.embedding.length === 0) {
      continue;
    }
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (score >= config.similarityThreshold) {
      scored.push({ chunk, score });
    }
  }

  // Sort descending by score, take top-K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, config.maxResults);
}

/**
 * Build a RAG context string suitable for injection into a review prompt.
 */
export function buildRagContextSection(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return '';
  }

  const sections = results.map((r, idx) => {
    const { chunk, score } = r;
    const pct = Math.round(score * 100);
    return [
      `#### Relevant snippet ${idx + 1} — \`${chunk.filePath}\` (lines ${chunk.startLine}–${chunk.endLine}, similarity ${pct}%)`,
      '```',
      chunk.content,
      '```',
    ].join('\n');
  });

  return [
    '\n\n---',
    '## Related Code from Codebase (RAG context)',
    'The following existing code snippets were retrieved as semantically similar to the diff. Use them as additional context when reviewing:',
    '',
    ...sections,
    '---',
  ].join('\n');
}

/**
 * Retrieve relevant chunks and build the RAG context for a diff.
 * The diff is used as the query; snippets from the changed files are excluded.
 */
export async function getRagContext(
  diff: string,
  changedFilePaths: string[],
  store: JsonVectorStore,
  config: RagConfig,
  ollamaEndpoint: string,
  useOllamaEmbeddings: boolean,
): Promise<RagContext> {
  // Use the first 2000 chars of the diff as the query (enough for semantic matching)
  const query = diff.slice(0, 2000);

  const results = await retrieveRelevantChunks(
    query,
    store,
    config,
    ollamaEndpoint,
    useOllamaEmbeddings,
  );

  // Filter out chunks from files already present in the diff (avoid redundancy)
  const filtered = results.filter(
    r => !changedFilePaths.some(p => r.chunk.filePath.endsWith(p) || p.endsWith(r.chunk.filePath)),
  );

  const summary =
    filtered.length > 0
      ? `Retrieved ${filtered.length} related code snippet(s) from the codebase index.`
      : 'No similar code found in the index.';

  return { results: filtered, summary };
}
