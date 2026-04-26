import * as vscode from 'vscode';
import { ReleaseWebviewPanel } from '../release/releaseWebviewPanel';
import { CommandContext } from './commandContext';

export function registerReleaseCommands(context: CommandContext): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
        vscode.commands.registerCommand('ollama-code-review.openReleaseOrchestrator', () => {
            ReleaseWebviewPanel.createOrShow(context.extensionContext);
        })
    );

    disposables.push(
        vscode.commands.registerCommand('ollama-code-review.setAdoToken', async () => {
            const token = await vscode.window.showInputBox({
                prompt: 'Enter your Azure DevOps Personal Access Token (PAT)',
                password: true,
                ignoreFocusOut: true
            });
            if (token) {
                await context.extensionContext.secrets.store('ado.token', token);
                vscode.window.showInformationMessage('Azure DevOps PAT stored securely.');
            }
        })
    );

    return disposables;
}
