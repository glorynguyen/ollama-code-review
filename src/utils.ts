import * as vscode from 'vscode';

export function getOllamaModel(config: vscode.WorkspaceConfiguration): string {
    let model = config.get<string>('model', 'kimi-k2.5:cloud');
    if (model === 'custom') {
        model = config.get<string>('customModel') || 'kimi-k2.5:cloud';
    }
    return model;
}

/**
 * Escapes HTML special characters to prevent XSS in webview content.
 * @param text - The text to escape
 * @returns The escaped text safe for HTML rendering
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
