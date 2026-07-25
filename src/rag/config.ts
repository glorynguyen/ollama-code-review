/**
 * F-009: RAG-Enhanced Reviews
 * VS Code configuration reader for RAG settings.
 */

import * as vscode from 'vscode';
import { RagConfig, DEFAULT_RAG_CONFIG } from './types';

/**
 * Resolve the storage directory for the RAG vector store.
 * Prefers workspace-scoped storage so each repository gets its own index
 * (no cross-workspace contamination); falls back to global storage when
 * no workspace is open (e.g. empty or virtual windows).
 */
export function resolveRagStoragePath(
  context: Pick<vscode.ExtensionContext, 'storageUri' | 'globalStorageUri'>,
): string {
  return (context.storageUri ?? context.globalStorageUri).fsPath;
}

/** Read RAG configuration from VS Code settings, merging with defaults. */
export function getRagConfig(): RagConfig {
  const cfg = vscode.workspace.getConfiguration('ollama-code-review');
  const raw = cfg.get<Partial<RagConfig>>('rag', {});
  return {
    ...DEFAULT_RAG_CONFIG,
    ...raw,
  };
}
