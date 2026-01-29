import * as vscode from 'vscode';

export function getOllamaModel(config: vscode.WorkspaceConfiguration): string {
    let model = config.get<string>('model', 'kimi-k2.5:cloud');
    if (model === 'custom') {
        model = config.get<string>('customModel') || 'kimi-k2.5:cloud';
    }
    return model;
}
