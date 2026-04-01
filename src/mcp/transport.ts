import * as http from 'http';

export type McpRequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

/**
 * Creates an HTTP server that routes /mcp requests to a per-request handler.
 *
 * - POST /mcp  → tool calls, initialize, etc.
 * - GET  /mcp  → SSE stream for server-initiated notifications
 * - DELETE /mcp → session cleanup
 * - GET /health → health check
 */
export function createHttpServer(handleMcpRequest: McpRequestHandler): http.Server {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;

		// CORS headers for local MCP clients
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
		res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.method === 'GET' && pathname === '/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ status: 'ok', server: 'ollama-code-review-mcp' }));
			return;
		}

		// Route all /mcp traffic — each request gets a fresh transport + server
		if (pathname === '/mcp') {
			handleMcpRequest(req, res).catch((err) => {
				if (!res.headersSent) {
					res.writeHead(500, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: String(err) }));
				}
			});
			return;
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	});

	return server;
}

/**
 * Start listening on the given port, bound to localhost only.
 * Rejects if the port is already in use.
 */
export function listen(server: http.Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				reject(new Error(`Port ${port} is already in use. Change ollama-code-review.mcp.port in settings.`));
			} else {
				reject(err);
			}
		});
		server.listen(port, '127.0.0.1', () => {
			resolve();
		});
	});
}
