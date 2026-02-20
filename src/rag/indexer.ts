/**
 * F-009: RAG-Enhanced Reviews
 * Code indexer — chunks workspace files and stores embeddings.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { CodeChunk, RagConfig, IndexingStats } from './types';
import { JsonVectorStore } from './vectorStore';
import { generateEmbedding, generateFallbackEmbedding } from './embeddings';

/** Split text into overlapping chunks. */
export function chunkText(
  text: string,
  filePath: string,
  chunkSize: number,
  chunkOverlap: number,
): Array<Omit<CodeChunk, 'embedding' | 'indexedAt'>> {
  const lines = text.split('\n');
  const chunks: Array<Omit<CodeChunk, 'embedding' | 'indexedAt'>> = [];

  let startLine = 0; // 0-indexed internally, converted on output

  while (startLine < lines.length) {
    // Accumulate lines until we hit the size limit
    let content = '';
    let endLine = startLine;

    while (endLine < lines.length && content.length < chunkSize) {
      content += (content ? '\n' : '') + lines[endLine];
      endLine++;
    }

    if (content.trim().length === 0) {
      startLine = endLine;
      continue;
    }

    const id = crypto
      .createHash('sha256')
      .update(`${filePath}:${startLine}:${endLine}`)
      .digest('hex')
      .slice(0, 16);

    chunks.push({
      id,
      filePath,
      startLine: startLine + 1, // 1-indexed
      endLine: endLine,          // 1-indexed (last line included)
      content,
    });

    // Advance with overlap
    const overlapLines = Math.floor(chunkOverlap / (chunkSize / Math.max(endLine - startLine, 1)));
    startLine = Math.max(startLine + 1, endLine - overlapLines);
  }

  return chunks;
}

/**
 * Index a single file into the vector store.
 * Returns the number of chunks created.
 */
export async function indexFile(
  fileUri: vscode.Uri,
  workspaceRoot: string,
  store: JsonVectorStore,
  config: RagConfig,
  ollamaEndpoint: string,
  useOllamaEmbeddings: boolean,
): Promise<number> {
  const relativePath = path.relative(workspaceRoot, fileUri.fsPath).replace(/\\/g, '/');

  // Remove old chunks for this file
  store.removeFile(relativePath);

  let text: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    text = Buffer.from(bytes).toString('utf8');
  } catch {
    return 0;
  }

  // Skip very large files (> 500 KB)
  if (text.length > 500_000) {
    return 0;
  }

  const rawChunks = chunkText(text, relativePath, config.chunkSize, config.chunkOverlap);
  const now = new Date().toISOString();

  for (const raw of rawChunks) {
    let embedding: number[];

    if (useOllamaEmbeddings) {
      const ollamaEmb = await generateEmbedding(raw.content, config.embeddingModel, ollamaEndpoint);
      embedding = ollamaEmb ?? generateFallbackEmbedding(raw.content);
    } else {
      embedding = generateFallbackEmbedding(raw.content);
    }

    const chunk: CodeChunk = { ...raw, embedding, indexedAt: now };
    store.upsertChunk(chunk);
  }

  return rawChunks.length;
}

/**
 * Index (or re-index) all workspace files matching the configured globs.
 * Reports progress via the VS Code notification API.
 */
export async function indexWorkspace(
  store: JsonVectorStore,
  config: RagConfig,
  ollamaEndpoint: string,
  useOllamaEmbeddings: boolean,
  outputChannel: vscode.OutputChannel,
  cancellationToken?: vscode.CancellationToken,
): Promise<IndexingStats> {
  const startTime = Date.now();
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { filesIndexed: 0, chunksCreated: 0, filesSkipped: 0, durationMs: 0 };
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const excludePatterns = config.excludeGlob
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .join(',');

  const files = await vscode.workspace.findFiles(
    config.includeGlob,
    `{${excludePatterns}}`,
    5_000,
  );

  outputChannel.appendLine(`[RAG] Indexing ${files.length} workspace files…`);

  let filesIndexed = 0;
  let filesSkipped = 0;
  let chunksCreated = 0;

  for (const file of files) {
    if (cancellationToken?.isCancellationRequested) {
      break;
    }

    try {
      const created = await indexFile(file, workspaceRoot, store, config, ollamaEndpoint, useOllamaEmbeddings);
      if (created > 0) {
        filesIndexed++;
        chunksCreated += created;
      } else {
        filesSkipped++;
      }
    } catch (err) {
      filesSkipped++;
      outputChannel.appendLine(`[RAG] Skipped ${file.fsPath}: ${err}`);
    }
  }

  store.flush();

  const durationMs = Date.now() - startTime;
  outputChannel.appendLine(
    `[RAG] Index complete: ${filesIndexed} files, ${chunksCreated} chunks, ${filesSkipped} skipped (${(durationMs / 1000).toFixed(1)}s)`,
  );

  return { filesIndexed, chunksCreated, filesSkipped, durationMs };
}
