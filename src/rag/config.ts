/**
 * F-009: RAG-Enhanced Reviews
 * VS Code configuration reader for RAG settings.
 */

import * as vscode from 'vscode';
import { RagConfig, DEFAULT_RAG_CONFIG } from './types';

/** Read RAG configuration from VS Code settings, merging with defaults. */
export function getRagConfig(): RagConfig {
  const cfg = vscode.workspace.getConfiguration('ollama-code-review');
  const raw = cfg.get<Partial<RagConfig>>('rag', {});
  return {
    ...DEFAULT_RAG_CONFIG,
    ...raw,
  };
}
