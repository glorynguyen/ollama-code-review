import * as vscode from 'vscode';
import { ConversationManager } from './chat/conversationManager';
import { ChatSidebarProvider } from './chat/sidebarProvider';
import { McpClientManager } from './mcp/mcpClientManager';
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
	const mcpClientManager = new McpClientManager();
	const successCount = await mcpClientManager.initialize();
	context.subscriptions.push(mcpClientManager);

	const mcpConfig = vscode.workspace.getConfiguration('ollama-code-review.mcp');
	const externalServers = mcpConfig.get<Record<string, any>>('externalServers', {});
	const serverCount = Object.keys(externalServers).length;

	if (serverCount > 0) {
		if (successCount === serverCount) {
			vscode.window.setStatusBarMessage(`$(check) MCP: ${successCount} servers connected`, 5000);
		} else {
			vscode.window.showWarningMessage(`MCP: Only ${successCount}/${serverCount} servers connected. Check the output channel for details.`);
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('ai-review.restartMcp', async () => {
			await mcpClientManager.restartAll();
			vscode.window.showInformationMessage('MCP servers restarted.');
		}),
	);

	const conversationManager = new ConversationManager(context.globalState);
	const chatSidebarProvider = new ChatSidebarProvider(
		context.extensionUri,
		conversationManager,
		context.globalStorageUri.fsPath,
		mcpClientManager,
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
