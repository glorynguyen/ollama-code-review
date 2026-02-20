/**
 * F-009: RAG-Enhanced Reviews
 * JSON-based vector store — persists indexed code chunks in global storage.
 * No native SQLite dependency required; compatible with VS Code extension sandboxing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CodeChunk, VectorStore } from './types';

const STORE_FILE = 'rag-index.json';
const STORE_VERSION = 1;

export class JsonVectorStore {
  private readonly storePath: string;
  private store: VectorStore;
  private dirty = false;

  constructor(globalStoragePath: string) {
    this.storePath = path.join(globalStoragePath, STORE_FILE);
    this.store = this.load();
  }

  // ─── public API ────────────────────────────────────────────────────────────

  get chunkCount(): number {
    return this.store.chunkCount;
  }

  get updatedAt(): string {
    return this.store.updatedAt;
  }

  /** Upsert a chunk (insert or replace by ID). */
  upsertChunk(chunk: CodeChunk): void {
    this.store.chunks[chunk.id] = chunk;
    this.store.chunkCount = Object.keys(this.store.chunks).length;
    this.dirty = true;
  }

  /** Remove all chunks belonging to a file path. */
  removeFile(filePath: string): void {
    const before = Object.keys(this.store.chunks).length;
    for (const id of Object.keys(this.store.chunks)) {
      if (this.store.chunks[id].filePath === filePath) {
        delete this.store.chunks[id];
      }
    }
    const removed = before - Object.keys(this.store.chunks).length;
    if (removed > 0) {
      this.store.chunkCount = Object.keys(this.store.chunks).length;
      this.dirty = true;
    }
  }

  /** Return all chunks as an array. */
  getAllChunks(): CodeChunk[] {
    return Object.values(this.store.chunks);
  }

  /** Return chunks for a specific file. */
  getChunksForFile(filePath: string): CodeChunk[] {
    return Object.values(this.store.chunks).filter(c => c.filePath === filePath);
  }

  /** Return unique file paths present in the index. */
  getIndexedFiles(): string[] {
    const files = new Set<string>();
    for (const chunk of Object.values(this.store.chunks)) {
      files.add(chunk.filePath);
    }
    return Array.from(files);
  }

  /** Clear the entire index. */
  clear(): void {
    this.store = emptyStore();
    this.dirty = true;
    this.flush();
  }

  /** Persist to disk. */
  flush(): void {
    if (!this.dirty) {
      return;
    }
    try {
      this.store.updatedAt = new Date().toISOString();
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify(this.store), 'utf8');
      this.dirty = false;
    } catch {
      // Ignore write errors — index will be rebuilt on next session
    }
  }

  // ─── private helpers ───────────────────────────────────────────────────────

  private load(): VectorStore {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        const parsed = JSON.parse(raw) as VectorStore;
        if (parsed?.version === STORE_VERSION && parsed.chunks) {
          return parsed;
        }
      }
    } catch {
      // Corrupt or missing — start fresh
    }
    return emptyStore();
  }
}

function emptyStore(): VectorStore {
  return {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    chunkCount: 0,
    chunks: {},
  };
}
