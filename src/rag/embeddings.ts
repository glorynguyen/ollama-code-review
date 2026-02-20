/**
 * F-009: RAG-Enhanced Reviews
 * Embedding generation using Ollama's /api/embeddings endpoint.
 * Falls back to a simple TF-IDF approximation when the model is unavailable.
 */

import axios from 'axios';
import * as vscode from 'vscode';

/**
 * Generate an embedding vector for the given text using Ollama.
 * Returns null if the embedding model is not available.
 */
export async function generateEmbedding(
  text: string,
  embeddingModel: string,
  ollamaEndpoint: string,
): Promise<number[] | null> {
  // Derive Ollama base from the generate endpoint (strip /api/generate)
  const baseUrl = ollamaEndpoint.replace(/\/api\/generate\/?$/, '');

  try {
    const response = await axios.post(
      `${baseUrl}/api/embeddings`,
      { model: embeddingModel, prompt: text },
      { timeout: 30_000 },
    );

    const embedding: number[] = response.data?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return null;
    }
    return embedding;
  } catch {
    // Model not available or Ollama not running — fall back to TF-IDF
    return null;
  }
}

/**
 * Generate a lightweight TF-IDF-based pseudo-embedding for a text.
 * Used as a fallback when the Ollama embedding model is unavailable.
 * The vector has 512 dimensions, hashed from token frequencies.
 */
export function generateFallbackEmbedding(text: string): number[] {
  const DIMS = 512;
  const vector = new Array<number>(DIMS).fill(0);

  // Tokenise (letters + digits only, lowercased)
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 1);

  const termFrequency: Map<string, number> = new Map();
  for (const token of tokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  // Project each unique term onto a hashed dimension
  for (const [term, freq] of termFrequency) {
    const hash = djb2Hash(term);
    const dim = ((hash % DIMS) + DIMS) % DIMS; // positive index
    vector[dim] += freq;
  }

  return normalise(vector);
}

/** Compute cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Check whether the Ollama embedding endpoint is reachable. */
export async function isEmbeddingModelAvailable(
  embeddingModel: string,
  ollamaEndpoint: string,
): Promise<boolean> {
  try {
    const result = await generateEmbedding('test', embeddingModel, ollamaEndpoint);
    return result !== null;
  } catch {
    return false;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash;
}

function normalise(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? v : v.map(x => x / norm);
}
