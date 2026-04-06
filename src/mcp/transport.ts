import * as http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mcpBridge } from './context';

export type McpRequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
export interface McpListenOptions {
	autoKillPortConflicts?: boolean;
	log?: (message: string) => void;
}

const execFileAsync = promisify(execFile);

function resolveAllowedOrigin(originHeader: string | undefined): string | null {
	if (!originHeader) {
		return null;
	}

	for (const rule of mcpBridge.getMcpAllowedOrigins()) {
		if (rule === originHeader) {
			return originHeader;
		}
		if (rule === 'chrome-extension://*' && originHeader.startsWith('chrome-extension://')) {
			return originHeader;
		}
	}

	return null;
}

function applyCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
	const allowedOrigin = resolveAllowedOrigin(req.headers.origin);
	if (allowedOrigin) {
		res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
		res.setHeader('Vary', 'Origin');
	}

	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
	res.setHeader(
		'Access-Control-Allow-Headers',
		'Content-Type, Accept, Authorization, MCP-Protocol-Version, mcp-session-id, X-OCR-MCP-Token',
	);
	res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

	if (req.headers['access-control-request-private-network'] === 'true') {
		res.setHeader('Access-Control-Allow-Private-Network', 'true');
	}
}

function isRequestAuthorized(req: http.IncomingMessage): boolean {
	const expectedToken = mcpBridge.getMcpAuthToken();
	if (!expectedToken) {
		return true;
	}

	const providedToken = req.headers['x-ocr-mcp-token'];
	return typeof providedToken === 'string' && providedToken === expectedToken;
}

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

		applyCorsHeaders(req, res);

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
			if (!isRequestAuthorized(req)) {
				res.writeHead(401, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Unauthorized' }));
				return;
			}

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
 * Rejects if the port is already in use unless auto-kill is enabled.
 */
export async function listen(server: http.Server, port: number, options: McpListenOptions = {}): Promise<void> {
	try {
		await listenOnce(server, port);
	} catch (err) {
		const error = err as NodeJS.ErrnoException;
		if (error.code !== 'EADDRINUSE' || !options.autoKillPortConflicts) {
			throw wrapListenError(port, error);
		}

		options.log?.(`Port ${port} is in use — attempting to terminate the existing listener.`);
		const killedPids = await killProcessesUsingPort(port, options.log);
		if (killedPids.length === 0) {
			throw new Error(
				`Port ${port} is already in use and no owning process could be terminated automatically. ` +
				'Change ollama-code-review.mcp.port in settings or disable auto-kill.',
			);
		}

		await waitForPortRelease(port, 3000);
		await listenOnce(server, port);
	}
}

function listenOnce(server: http.Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (err: NodeJS.ErrnoException): void => {
			cleanup();
			reject(err);
		};
		const onListening = (): void => {
			cleanup();
			resolve();
		};
		const cleanup = (): void => {
			server.off('error', onError);
			server.off('listening', onListening);
		};

		server.once('error', onError);
		server.once('listening', onListening);
		server.listen(port, '127.0.0.1');
	});
}

function wrapListenError(port: number, err: NodeJS.ErrnoException): Error {
	if (err.code === 'EADDRINUSE') {
		return new Error(`Port ${port} is already in use. Change ollama-code-review.mcp.port in settings.`);
	}
	return err;
}

async function killProcessesUsingPort(port: number, log?: (message: string) => void): Promise<number[]> {
	const pids = (await getListeningPids(port)).filter(pid => pid !== process.pid);
	for (const pid of pids) {
		log?.(`Terminating process ${pid} using MCP port ${port}.`);
		await terminatePid(pid);
	}
	return pids;
}

async function getListeningPids(port: number): Promise<number[]> {
	if (process.platform === 'win32') {
		return getListeningPidsWindows(port);
	}
	return getListeningPidsUnix(port);
}

async function getListeningPidsUnix(port: number): Promise<number[]> {
	try {
		const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
		return parsePidList(stdout);
	} catch (err) {
		const error = err as NodeJS.ErrnoException & { stdout?: string };
		if (typeof error.stdout === 'string' && error.stdout.trim()) {
			return parsePidList(error.stdout);
		}
		if (error.code === 'ENOENT') {
			throw new Error('Could not inspect port usage because `lsof` is not available on this system.');
		}
		return [];
	}
}

async function getListeningPidsWindows(port: number): Promise<number[]> {
	const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp']);
	const pids = new Set<number>();
	for (const line of stdout.split(/\r?\n/)) {
		const normalized = line.trim();
		if (!normalized) { continue; }
		const parts = normalized.split(/\s+/);
		if (parts.length < 5) { continue; }
		const localAddress = parts[1];
		const state = parts[3];
		const pid = Number(parts[4]);
		if (!Number.isFinite(pid) || state.toUpperCase() !== 'LISTENING') { continue; }
		if (matchesPort(localAddress, port)) {
			pids.add(pid);
		}
	}
	return [...pids];
}

function matchesPort(address: string, port: number): boolean {
	const match = address.match(/:(\d+)$/);
	return match ? Number(match[1]) === port : false;
}

function parsePidList(stdout: string): number[] {
	return [...new Set(
		stdout
			.split(/\r?\n/)
			.map(line => Number(line.trim()))
			.filter(pid => Number.isInteger(pid) && pid > 0),
	)];
}

async function terminatePid(pid: number): Promise<void> {
	if (process.platform === 'win32') {
		await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']);
		return;
	}

	try {
		process.kill(pid, 'SIGTERM');
	} catch (err) {
		const error = err as NodeJS.ErrnoException;
		if (error.code !== 'ESRCH') {
			throw error;
		}
		return;
	}

	await sleep(250);
	try {
		process.kill(pid, 0);
		process.kill(pid, 'SIGKILL');
	} catch (err) {
		const error = err as NodeJS.ErrnoException;
		if (error.code !== 'ESRCH') {
			throw error;
		}
	}
}

async function waitForPortRelease(port: number, timeoutMs: number): Promise<void> {
	const startedAt = Date.now();
	while ((Date.now() - startedAt) < timeoutMs) {
		const pids = (await getListeningPids(port)).filter(pid => pid !== process.pid);
		if (pids.length === 0) {
			return;
		}
		await sleep(150);
	}
	throw new Error(`Timed out waiting for port ${port} to become available after terminating the previous listener.`);
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
