import * as http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAllTools } from './tools';
import { registerAllResources } from './resources';
import { createHttpServer, listen } from './transport';
import { mcpBridge } from './context';

export interface McpServerInstance {
	start(): Promise<void>;
	stop(): Promise<void>;
	isRunning(): boolean;
	port: number;
}

/**
 * Create an MCP server instance with all tools and resources registered.
 * Uses StreamableHTTPServerTransport in stateless mode — each request gets
 * a fresh transport + McpServer pair (required by SDK v1.29+).
 * The server is NOT started until `.start()` is called.
 */
export function createMcpServer(port: number): McpServerInstance {
	let httpServer: http.Server | null = null;
	let running = false;

	return {
		port,

		async start(): Promise<void> {
			if (running) { return; }

			// Per-request handler: SDK stateless mode requires a fresh transport per request
			async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: undefined, // stateless mode
				});

				const mcp = new McpServer(
					{ name: 'ollama-code-review', version: '1.0.0' },
					{ capabilities: { tools: {}, resources: {} } },
				);

				registerAllTools(mcp);
				registerAllResources(mcp);

				await mcp.connect(transport);
				await transport.handleRequest(req, res);
				await transport.close();
				await mcp.close();
			}

			httpServer = createHttpServer(handleMcpRequest);
			await listen(httpServer, port);

			running = true;
			mcpBridge.log(`MCP server listening on http://127.0.0.1:${port}/mcp`);
		},

		async stop(): Promise<void> {
			if (!running) { return; }

			if (httpServer) {
				await new Promise<void>((resolve, reject) => {
					httpServer!.close((err) => {
						if (err) { reject(err); } else { resolve(); }
					});
				});
				httpServer = null;
			}

			running = false;
			mcpBridge.log('MCP server stopped');
		},

		isRunning(): boolean {
			return running;
		},
	};
}
