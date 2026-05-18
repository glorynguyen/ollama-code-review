import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { mcpBridge } from '../mcp/context';
import { SembleService } from '../mcp/sembleService';

const FAKE_WORKER = `#!/usr/bin/env node
const readline = require('readline');

const indexes = new Map();
const rl = readline.createInterface({ input: process.stdin });

console.log('worker ready but not json');

function resultFor(repositoryPath, query, topK) {
  return Array.from({ length: topK }, (_, index) => ({
    filePath: 'src/example-' + index + '.ts',
    startLine: index + 1,
    endLine: index + 2,
    content: query + ':' + index,
    score: 1 - index / 10,
  }));
}

rl.on('line', (line) => {
  const payload = JSON.parse(line);
  try {
    if (payload.command === 'status') {
      const result = {
        available: true,
        indexes: Array.from(indexes.values()),
      };
      console.log(JSON.stringify({ id: payload.id, ok: true, result }));
      return;
    }

    if (payload.command === 'index') {
      const result = {
        repositoryPath: payload.repositoryPath,
        chunkCount: 3,
        indexedAt: '2026-05-18T00:00:00Z',
        durationMs: 7,
      };
      indexes.set(payload.repositoryPath, {
        repositoryPath: payload.repositoryPath,
        chunkCount: 3,
        indexedAt: '2026-05-18T00:00:00Z',
      });
      console.log(JSON.stringify({ id: payload.id, ok: true, result }));
      return;
    }

    if (payload.command === 'search') {
      if (payload.query === 'explode') {
        console.log(JSON.stringify({ id: payload.id, ok: false, error: 'fake search failure', traceback: 'traceback text' }));
        return;
      }
      console.log(JSON.stringify({
        id: payload.id,
        ok: true,
        result: resultFor(payload.repositoryPath, payload.query, payload.topK),
      }));
      return;
    }

    if (payload.command === 'related') {
      console.log(JSON.stringify({
        id: payload.id,
        ok: true,
        result: resultFor(payload.repositoryPath, payload.snippet, payload.topK),
      }));
      return;
    }

    console.log(JSON.stringify({ id: payload.id, ok: false, error: 'unknown command' }));
  } catch (error) {
    console.log(JSON.stringify({ id: payload.id, ok: false, error: String(error) }));
  }
});
`;

suite('MCP Semble Service Test Suite', () => {
	let tempRoot: string;
	let fakeExecutablePath: string;
	let service: SembleService;
	let logs: string[];
	let originalGetConfig: typeof mcpBridge.getConfig;
	let originalGetGlobalStoragePath: typeof mcpBridge.getGlobalStoragePath;
	let originalLog: typeof mcpBridge.log;

	setup(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-mcp-semble-service-'));
		fakeExecutablePath = path.join(tempRoot, 'fake-semble-worker');
		await fs.writeFile(fakeExecutablePath, FAKE_WORKER, 'utf8');
		await fs.chmod(fakeExecutablePath, 0o755);

		logs = [];
		originalGetConfig = mcpBridge.getConfig;
		originalGetGlobalStoragePath = mcpBridge.getGlobalStoragePath;
		originalLog = mcpBridge.log;

		(mcpBridge as any).getConfig = () => ({
			get: (key: string, defaultValue?: unknown) => {
				if (key === 'mcp.semble.pythonPath') {
					return fakeExecutablePath;
				}
				return defaultValue;
			},
		});
		(mcpBridge as any).getGlobalStoragePath = () => tempRoot;
		(mcpBridge as any).log = (message: string) => logs.push(message);

		service = new SembleService();
	});

	teardown(async () => {
		service.dispose();
		(mcpBridge as any).getConfig = originalGetConfig;
		(mcpBridge as any).getGlobalStoragePath = originalGetGlobalStoragePath;
		(mcpBridge as any).log = originalLog;
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	test('writes the worker script to global storage and returns index status', async () => {
		const result = await service.indexRepository('/repo');
		const status = await service.getStatus();
		const workerScript = await fs.readFile(path.join(tempRoot, 'mcp', 'semble_worker.py'), 'utf8');

		assert.strictEqual(result.repositoryPath, '/repo');
		assert.strictEqual(result.chunkCount, 3);
		assert.strictEqual(result.durationMs, 7);
		assert.deepStrictEqual(status.indexes, [{
			repositoryPath: '/repo',
			chunkCount: 3,
			indexedAt: '2026-05-18T00:00:00Z',
		}]);
		assert.match(workerScript, /from semble import SembleIndex/);
		assert.ok(logs.some(log => log.includes('Ignoring non-JSON worker output')));
	});

	test('sends search and related requests to the worker', async () => {
		const search = await service.search('/repo', 'parse config', 2);
		const related = await service.findRelated('/repo', 'function seed() {}', 1);

		assert.strictEqual(search.length, 2);
		assert.strictEqual(search[0].filePath, 'src/example-0.ts');
		assert.strictEqual(search[0].content, 'parse config:0');
		assert.strictEqual(related.length, 1);
		assert.strictEqual(related[0].content, 'function seed() {}:0');
	});

	test('rejects worker error responses and logs tracebacks', async () => {
		await assert.rejects(
			() => service.search('/repo', 'explode', 1),
			/fake search failure/,
		);

		assert.ok(logs.some(log => log.includes('traceback text')));
	});
});
