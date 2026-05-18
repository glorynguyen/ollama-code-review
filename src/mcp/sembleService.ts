import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { mcpBridge } from './context';

interface SembleWorkerResponse {
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
	errorType?: string;
	traceback?: string;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

export interface SembleCodeSearchResult {
	filePath: string;
	startLine: number;
	endLine: number;
	content: string;
	score?: number;
}

export interface SembleIndexResult {
	repositoryPath: string;
	chunkCount?: number;
	indexedAt: string;
	durationMs: number;
}

export interface SembleStatusResult {
	available: boolean;
	error?: string;
	indexes: Array<{
		repositoryPath: string;
		chunkCount?: number;
		indexedAt: string;
	}>;
}

const SEMBLE_WORKER_SCRIPT = String.raw`
import json
import sys
import time
import traceback

indexes = {}
metadata = {}

try:
    from semble import SembleIndex
    SEMBLE_IMPORT_ERROR = None
except Exception as exc:
    SembleIndex = None
    SEMBLE_IMPORT_ERROR = str(exc)


def chunk_count(index):
    for attr in ("chunks", "_chunks"):
        value = getattr(index, attr, None)
        if value is not None:
            try:
                return len(value)
            except Exception:
                pass
    return None


def result_to_dict(result):
    chunk = getattr(result, "chunk", None)
    score = getattr(result, "score", None)
    if score is None:
        score = getattr(result, "rrf_score", None)
    if score is None:
        score = getattr(result, "similarity", None)

    return {
        "filePath": getattr(chunk, "file_path", "") if chunk is not None else "",
        "startLine": getattr(chunk, "start_line", 0) if chunk is not None else 0,
        "endLine": getattr(chunk, "end_line", 0) if chunk is not None else 0,
        "content": getattr(chunk, "content", "") if chunk is not None else "",
        "score": score,
    }


def ensure_semble():
    if SembleIndex is None:
        raise RuntimeError(
            "Semble is not installed in the configured Python environment. "
            "Install it with 'pip install semble', or set "
            "'ollama-code-review.mcp.semble.pythonPath' to a Python executable that has Semble."
        )


def ensure_index(repository_path):
    ensure_semble()
    if repository_path not in indexes:
        index_repository(repository_path)
    return indexes[repository_path]


def index_repository(repository_path):
    ensure_semble()
    start = time.time()
    index = SembleIndex.from_path(repository_path)
    indexes[repository_path] = index
    indexed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    metadata[repository_path] = {
        "repositoryPath": repository_path,
        "chunkCount": chunk_count(index),
        "indexedAt": indexed_at,
    }
    return {
        **metadata[repository_path],
        "durationMs": int((time.time() - start) * 1000),
    }


def handle(payload):
    command = payload.get("command")
    if command == "status":
        return {
            "available": SembleIndex is not None,
            "error": SEMBLE_IMPORT_ERROR,
            "indexes": list(metadata.values()),
        }

    repository_path = payload.get("repositoryPath")

    if command == "index":
        return index_repository(repository_path)

    if command == "search":
        index = ensure_index(repository_path)
        query = payload.get("query", "")
        top_k = int(payload.get("topK") or 5)
        return [result_to_dict(item) for item in index.search(query, top_k=top_k)]

    if command == "related":
        index = ensure_index(repository_path)
        snippet = payload.get("snippet", "")
        top_k = int(payload.get("topK") or 5)
        seed = index.search(snippet, top_k=1)
        if not seed:
            return []
        return [result_to_dict(item) for item in index.find_related(seed[0], top_k=top_k)]

    raise ValueError(f"Unknown command: {command}")


for line in sys.stdin:
    try:
        payload = json.loads(line)
        request_id = payload.get("id")
        result = handle(payload)
        response = {"id": request_id, "ok": True, "result": result}
    except Exception as exc:
        response = {
            "id": payload.get("id") if "payload" in locals() else None,
            "ok": False,
            "error": str(exc),
            "errorType": exc.__class__.__name__,
            "traceback": traceback.format_exc(),
        }
    print(json.dumps(response), flush=True)
`;

export class SembleService {
	private process: ChildProcessWithoutNullStreams | undefined;
	private pending = new Map<number, PendingRequest>();
	private nextId = 1;
	private workerScriptPath: string | undefined;

	async indexRepository(repositoryPath: string): Promise<SembleIndexResult> {
		return this.send('index', { repositoryPath }, 5 * 60_000) as Promise<SembleIndexResult>;
	}

	async search(repositoryPath: string, query: string, topK: number): Promise<SembleCodeSearchResult[]> {
		return this.send('search', { repositoryPath, query, topK }, 60_000) as Promise<SembleCodeSearchResult[]>;
	}

	async findRelated(repositoryPath: string, snippet: string, topK: number): Promise<SembleCodeSearchResult[]> {
		return this.send('related', { repositoryPath, snippet, topK }, 60_000) as Promise<SembleCodeSearchResult[]>;
	}

	async getStatus(): Promise<SembleStatusResult> {
		return this.send('status', {}, 30_000) as Promise<SembleStatusResult>;
	}

	dispose(): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error('Semble worker was disposed.'));
		}
		this.pending.clear();
		this.process?.kill();
		this.process = undefined;
	}

	private async send(command: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
		await this.ensureWorker();
		const worker = this.process;
		if (!worker || worker.killed || !worker.stdin.writable) {
			throw new Error('Semble worker is not running.');
		}

		const id = this.nextId++;
		const message = JSON.stringify({ id, command, ...payload }) + '\n';

		return new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Semble ${command} timed out after ${Math.round(timeoutMs / 1000)}s.`));
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timeout });
			worker.stdin.write(message, (err) => {
				if (!err) { return; }
				const pending = this.pending.get(id);
				if (pending) {
					clearTimeout(pending.timeout);
					this.pending.delete(id);
					pending.reject(err);
				}
			});
		});
	}

	private async ensureWorker(): Promise<void> {
		if (this.process && !this.process.killed) {
			return;
		}

		const scriptPath = await this.ensureWorkerScript();
		const pythonPath = this.resolvePythonPath();
		const child = spawn(pythonPath, ['-u', scriptPath], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		this.process = child;

		const lines = readline.createInterface({ input: child.stdout });
		lines.on('line', (line) => this.handleWorkerLine(line));

		child.stderr.on('data', (data: Buffer) => {
			const text = data.toString('utf8').trim();
			if (text) {
				mcpBridge.log(`[Semble] ${text}`);
			}
		});

		child.on('error', (err) => {
			this.rejectAllPending(new Error(`Failed to start Semble worker with "${pythonPath}": ${err.message}`));
		});

		child.on('exit', (code, signal) => {
			this.process = undefined;
			this.rejectAllPending(new Error(`Semble worker exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`));
		});
	}

	private async ensureWorkerScript(): Promise<string> {
		if (this.workerScriptPath) {
			return this.workerScriptPath;
		}

		const dir = path.join(mcpBridge.getGlobalStoragePath(), 'mcp');
		await fs.mkdir(dir, { recursive: true });
		const scriptPath = path.join(dir, 'semble_worker.py');
		await fs.writeFile(scriptPath, SEMBLE_WORKER_SCRIPT, 'utf8');
		this.workerScriptPath = scriptPath;
		return scriptPath;
	}

	private resolvePythonPath(): string {
		const configured = mcpBridge.getConfig().get<string>('mcp.semble.pythonPath', '').trim();
		if (configured) {
			return configured;
		}
		return process.platform === 'win32' ? 'python' : 'python3';
	}

	private handleWorkerLine(line: string): void {
		let response: SembleWorkerResponse;
		try {
			response = JSON.parse(line) as SembleWorkerResponse;
		} catch {
			mcpBridge.log(`[Semble] Ignoring non-JSON worker output: ${line}`);
			return;
		}

		const pending = this.pending.get(response.id);
		if (!pending) {
			return;
		}

		clearTimeout(pending.timeout);
		this.pending.delete(response.id);

		if (response.ok) {
			pending.resolve(response.result);
			return;
		}

		const message = response.error || response.errorType || 'Unknown Semble worker error.';
		if (response.traceback) {
			mcpBridge.log(`[Semble] ${response.traceback}`);
		}
		pending.reject(new Error(message));
	}

	private rejectAllPending(error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			clearTimeout(pending.timeout);
			this.pending.delete(id);
			pending.reject(error);
		}
	}
}

export const sembleService = new SembleService();

export function disposeSembleService(): void {
	sembleService.dispose();
}
