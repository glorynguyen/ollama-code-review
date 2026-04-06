import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Bridge between MCP tool handlers and VS Code extension context.
 * MCP tools operate in raw-data mode — no AI calls, just context gathering.
 */
export class McpExtensionBridge {
	private extensionContext: vscode.ExtensionContext | undefined;
	private outputChannel: vscode.OutputChannel | undefined;

	initialize(
		ctx: vscode.ExtensionContext,
		outputChannel: vscode.OutputChannel,
	): void {
		this.extensionContext = ctx;
		this.outputChannel = outputChannel;
	}

	get context(): vscode.ExtensionContext {
		if (!this.extensionContext) {
			throw new Error('McpExtensionBridge not initialized — VS Code extension not active');
		}
		return this.extensionContext;
	}

	get channel(): vscode.OutputChannel | undefined {
		return this.outputChannel;
	}

	getConfig(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('ollama-code-review');
	}

	getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
		return vscode.workspace.workspaceFolders ?? [];
	}

	getMcpAllowedOrigins(): string[] {
		return this.getConfig().get<string[]>('mcp.allowedOrigins', ['chrome-extension://*']);
	}

	getMcpAuthToken(): string {
		return this.getConfig().get<string>('mcp.authToken', '').trim();
	}

	getRepoPath(): string {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			throw new Error('No workspace folder open');
		}
		return folders[0].uri.fsPath;
	}

	runGit(repoPath: string, args: string[]): Promise<string> {
		return execFileAsync('git', args, {
			cwd: repoPath,
			maxBuffer: 10 * 1024 * 1024,
		}).then(({ stdout }) => stdout);
	}

	log(message: string): void {
		this.outputChannel?.appendLine(`[MCP] ${message}`);
	}

	getGlobalStoragePath(): string {
		return this.context.globalStorageUri.fsPath;
	}
}

/** Singleton bridge instance shared across all MCP tool handlers */
export const mcpBridge = new McpExtensionBridge();
