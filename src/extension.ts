import * as vscode from 'vscode';
import { ConversationManager } from './chat/conversationManager';
import { ChatSidebarProvider } from './chat/sidebarProvider';
import type { PerformanceMetrics } from './commands';

type CommandsModule = typeof import('./commands');

let commandsModule: CommandsModule | null = null;

function loadCommands(): CommandsModule {
	if (!commandsModule) {
		commandsModule = require('./commands') as CommandsModule;
	}
	return commandsModule;
}

export async function activate(context: vscode.ExtensionContext) {
	const conversationManager = new ConversationManager(context.globalState);
	const chatSidebarProvider = new ChatSidebarProvider(
		context.extensionUri,
		conversationManager,
		context.globalStorageUri.fsPath,
	);
	context.subscriptions.push(conversationManager);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatSidebarProvider.viewType, chatSidebarProvider, {
			webviewOptions: {
				retainContextWhenHidden: true,
			},
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('ai-review.focusChat', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.ai-review');
			await vscode.commands.executeCommand(`${ChatSidebarProvider.viewType}.focus`);
		}),
	);

	return loadCommands().activate(context);
}

export function deactivate() {
	return loadCommands().deactivate();
}

export async function checkActiveModels(config: vscode.WorkspaceConfiguration): Promise<PerformanceMetrics['activeModel'] | undefined> {
	return loadCommands().checkActiveModels(config);
}

export function getLastPerformanceMetrics(): PerformanceMetrics | null {
	return loadCommands().getLastPerformanceMetrics();
}

export function clearPerformanceMetrics(): void {
	loadCommands().clearPerformanceMetrics();
}

export type { PerformanceMetrics };
