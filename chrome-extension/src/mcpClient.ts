import type { WorkspaceRepo } from './types';

type JsonRpcSuccess<T> = {
	jsonrpc: '2.0';
	id: number | string;
	result: T;
};

type JsonRpcError = {
	jsonrpc: '2.0';
	id: number | string | null;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
};

type ToolCallResult = {
	content?: Array<{ type: string; text?: string }>;
};

export class McpClient {
	private initialized = false;
	private nextId = 1;
	private token = '';

	constructor(private readonly endpoint: string) {}

	setToken(token: string): void {
		this.token = token.trim();
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		await this.request('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: {
				name: 'ocr-browser-review',
				version: '0.1.0',
			},
		});
		this.initialized = true;
	}

	async getWorkspaceRepos(): Promise<WorkspaceRepo[]> {
		const result = await this.callTool('get_workspace_repos', {});
		return JSON.parse(extractText(result)) as WorkspaceRepo[];
	}

	async getBranchDiff(args: {
		repository_path: string;
		base_ref: string;
		target_ref: string;
	}): Promise<string> {
		const result = await this.callTool('get_branch_diff', args);
		return extractText(result);
	}

	async getStagedDiff(args: { repository_path?: string } = {}): Promise<string> {
		const result = await this.callTool('get_staged_diff', args);
		return extractText(result);
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
		return this.request('tools/call', {
			name,
			arguments: args,
		});
	}

	private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': '2024-11-05',
		};

		if (this.token) {
			headers['X-OCR-MCP-Token'] = this.token;
		}

		const response = await fetch(this.endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: this.nextId++,
				method,
				params,
			}),
		});

		if (!response.ok) {
			throw new Error(`MCP request failed with HTTP ${response.status}`);
		}

		const payload = await parseMcpResponse<T>(response);
		if ('error' in payload) {
			throw new Error(payload.error.message);
		}

		return payload.result;
	}
}

function extractText(result: ToolCallResult): string {
	const text = result.content?.find(entry => entry.type === 'text')?.text;
	if (!text) {
		throw new Error('MCP tool returned no text content.');
	}
	return text;
}

async function parseMcpResponse<T>(response: Response): Promise<JsonRpcSuccess<T> | JsonRpcError> {
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		return await response.json() as JsonRpcSuccess<T> | JsonRpcError;
	}

	if (contentType.includes('text/event-stream')) {
		const body = await response.text();
		return parseSsePayload<T>(body);
	}

	const body = await response.text();
	throw new Error(`Unsupported MCP response type: ${contentType || 'unknown'}\n${body}`);
}

function parseSsePayload<T>(body: string): JsonRpcSuccess<T> | JsonRpcError {
	const events = body
		.split(/\n\n+/)
		.map(chunk => chunk.trim())
		.filter(Boolean);

	for (const eventChunk of events) {
		const dataLines = eventChunk
			.split(/\n/)
			.filter(line => line.startsWith('data:'))
			.map(line => line.slice(5).trim())
			.filter(Boolean);

		if (dataLines.length === 0) {
			continue;
		}

		const dataText = dataLines.join('\n');
		if (dataText === '[DONE]') {
			continue;
		}

		try {
			const parsed = JSON.parse(dataText) as JsonRpcSuccess<T> | JsonRpcError;
			if ('result' in parsed || 'error' in parsed) {
				return parsed;
			}
		} catch {
			// Ignore non-JSON SSE frames and continue searching for the JSON-RPC payload.
		}
	}

	throw new Error(`Could not parse JSON-RPC payload from SSE response:\n${body}`);
}
