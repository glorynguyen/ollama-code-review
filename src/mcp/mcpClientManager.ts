import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
	ListToolsResultSchema,
	CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

interface McpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface McpTool {
	serverName: string;
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export class McpClientManager implements vscode.Disposable {
	private clients: Map<string, Client> = new Map();
	private transports: Map<string, StdioClientTransport> = new Map();
	private disposables: vscode.Disposable[] = [];
	private outputChannel: vscode.OutputChannel;
	private isRestarting = false;
	private configChangeTimer: NodeJS.Timeout | undefined;

	constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Ollama Code Review (MCP)');
		this.disposables.push(this.outputChannel);

		// Watch for configuration changes to restart servers with debounce
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('ollama-code-review.mcp.externalServers')) {
					if (this.configChangeTimer) {
						clearTimeout(this.configChangeTimer);
					}
					this.configChangeTimer = setTimeout(() => {
						this.restartAll().catch(err => {
							this.outputChannel.appendLine(`[MCP] Auto-restart failed: ${err}`);
						});
					}, 1000);
				}
			}),
		);
	}

	/** Initialize and connect to all configured external MCP servers. Returns the number of successfully connected servers. */
	public async initialize(): Promise<number> {
		if (this.isRestarting) {
			return 0;
		}
		this.isRestarting = true;
		try {
			return await this._initialize();
		} finally {
			this.isRestarting = false;
		}
	}

	private async _initialize(): Promise<number> {
		const config = vscode.workspace.getConfiguration('ollama-code-review.mcp');
		const servers = config.get<Record<string, McpServerConfig>>('externalServers', {});

		const entries = Object.entries(servers);
		if (entries.length === 0) {
			return 0;
		}

		this.outputChannel.appendLine(`[MCP] Initializing ${entries.length} external servers...`);

		const results = await Promise.allSettled(
			entries.map(([name, serverConfig]) => this.connectToServer(name, serverConfig))
		);

		let successCount = 0;
		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				successCount++;
			} else {
				const name = entries[index][0];
				const error = result.reason;
				this.outputChannel.appendLine(`[MCP] Failed to connect to server "${name}": ${error}`);
				vscode.window.showErrorMessage(`Failed to connect to MCP server "${name}": ${error}`);
			}
		});

		return successCount;
	}

	private async connectToServer(name: string, config: McpServerConfig): Promise<void> {
		if (this.clients.has(name)) {
			return;
		}

		this.outputChannel.appendLine(`[MCP] Connecting to server: ${name} (command: ${config.command})`);

		const env: Record<string, string> = {
			PATH: process.env.PATH || '',
			HOME: process.env.HOME || process.env.USERPROFILE || '',
			USER: process.env.USER || process.env.USERNAME || '',
		};

		// Only add server-specific variables from the config
		if (config.env) {
			for (const [key, value] of Object.entries(config.env)) {
				if (typeof value === 'string') {
					env[key] = value;
				} else if (value !== undefined && value !== null) {
					env[key] = String(value);
				}
			}
		}

		const transport = new StdioClientTransport({
			command: config.command,
			args: config.args ?? [],
			env,
		});

		const client = new Client(
			{
				name: 'ollama-code-review-client',
				version: '1.0.0',
			},
			{
				capabilities: {},
			},
		);

		const CONNECTION_TIMEOUT = 30000;
		let timeoutId: NodeJS.Timeout | undefined;
		try {
			// Track transport and client early so they can be disposed if needed
			this.transports.set(name, transport);
			this.clients.set(name, client);

			const connectPromise = client.connect(transport);
			const timeoutPromise = new Promise((_, reject) => {
				timeoutId = setTimeout(() => reject(new Error(`Connection to MCP server "${name}" timed out after ${CONNECTION_TIMEOUT}ms`)), CONNECTION_TIMEOUT);
			});

			await Promise.race([connectPromise, timeoutPromise]);
			if (timeoutId) { clearTimeout(timeoutId); }
			
			this.outputChannel.appendLine(`[MCP] Connected to server: ${name}`);
		} catch (error) {
			if (timeoutId) { clearTimeout(timeoutId); }
			this.outputChannel.appendLine(`[MCP] Error connecting to "${name}": ${error}`);
			// Ensure cleanup if connection fails
			try { 
				transport.close().catch(() => {});
			} catch { /* ignore */ }
			this.clients.delete(name);
			this.transports.delete(name);
			throw error;
		}
	}

	/** Get all tools from all connected MCP servers. */
	public async getAllTools(): Promise<McpTool[]> {
		const allTools: McpTool[] = [];

		for (const [name, client] of this.clients.entries()) {
			try {
				const response = await client.request(
					{ method: 'tools/list' },
					ListToolsResultSchema,
				);

				const tools = response.tools.map((tool) => ({
					serverName: name,
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema as Record<string, unknown>,
				}));

				allTools.push(...tools);
			} catch (error) {
				this.outputChannel.appendLine(`[MCP] Failed to list tools for server "${name}": ${error}`);
			}
		}

		return allTools;
	}

	/** Call a tool on a specific MCP server. */
	public async callTool(
		serverName: string,
		toolName: string,
		args: unknown,
	): Promise<unknown> {
		const client = this.clients.get(serverName);
		if (!client) {
			throw new Error(`MCP server "${serverName}" not found or not connected.`);
		}

		this.outputChannel.appendLine(`[MCP] Calling tool: ${serverName}/${toolName} with args: ${JSON.stringify(args)}`);

		try {
			const result = await client.request(
				{
					method: 'tools/call',
					params: {
						name: toolName,
						arguments: args as Record<string, unknown>,
					},
				},
				CallToolResultSchema,
			);
			return result;
		} catch (error) {
			this.outputChannel.appendLine(`[MCP] Tool call failed (${serverName}/${toolName}): ${error}`);
			throw error;
		}
	}

	public async restartAll(): Promise<void> {
		if (this.isRestarting) {
			this.outputChannel.appendLine('[MCP] Restart already in progress, skipping...');
			return;
		}

		this.isRestarting = true;
		try {
			this.outputChannel.appendLine('[MCP] Restarting all servers...');
			await this.disposeClients();
			await this._initialize();
		} finally {
			this.isRestarting = false;
		}
	}

	private async disposeClients(): Promise<void> {
		const clientEntries = [...this.clients.entries()];
		if (clientEntries.length > 0) {
			this.outputChannel.appendLine(`[MCP] Disposing ${clientEntries.length} clients...`);
		}

		const transportEntries = [...this.transports.entries()];

		await Promise.allSettled(
			clientEntries.map(async ([name, client]) => {
				try {
					if (typeof (client as any).close === 'function') {
						await (client as any).close();
					}
					this.outputChannel.appendLine(`[MCP] Disconnected from server: ${name}`);
				} catch (error) {
					this.outputChannel.appendLine(`[MCP] Error closing client "${name}": ${error}`);
				}
			})
		);

		await Promise.allSettled(
			transportEntries.map(async ([name, transport]) => {
				try {
					await transport.close();
				} catch (error) {
					this.outputChannel.appendLine(`[MCP] Error closing transport "${name}": ${error}`);
				}
			})
		);

		this.clients.clear();
		this.transports.clear();
	}

	public dispose(): void {
		if (this.configChangeTimer) {
			clearTimeout(this.configChangeTimer);
		}

		// Close all transports immediately to kill child processes (fire and forget)
		for (const transport of this.transports.values()) {
			transport.close().catch(() => {});
		}
		this.clients.clear();
		this.transports.clear();
		
		for (const d of this.disposables) {
			try { d.dispose(); } catch { /* ignore */ }
		}
	}
}
