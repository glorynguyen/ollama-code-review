import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonVectorStore } from '../rag/vectorStore';
import { getRagConfig, resolveRagStoragePath } from '../rag/config';
import { DEFAULT_RAG_CONFIG, type CodeChunk } from '../rag/types';

function makeChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
	return {
		id: 'chunk-1',
		filePath: 'src/example.ts',
		startLine: 1,
		endLine: 10,
		content: 'export const answer = 42;',
		embedding: [0.1, 0.2, 0.3],
		indexedAt: new Date().toISOString(),
		...overrides,
	};
}

suite('RAG Workspace-Scoped Storage Test Suite', () => {
	let tempDirs: string[] = [];

	function makeTempDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-store-test-'));
		tempDirs.push(dir);
		return dir;
	}

	teardown(() => {
		for (const dir of tempDirs) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	// ─── JsonVectorStore isolation ───────────────────────────────────────────

	suite('JsonVectorStore isolation', () => {
		test('stores on different paths are fully isolated', () => {
			const workspaceA = makeTempDir();
			const workspaceB = makeTempDir();

			const storeA = new JsonVectorStore(workspaceA);
			storeA.upsertChunk(makeChunk({ id: 'a-1', filePath: 'src/a.ts' }));
			storeA.upsertChunk(makeChunk({ id: 'a-2', filePath: 'src/a.ts' }));
			storeA.flush();

			const storeB = new JsonVectorStore(workspaceB);
			assert.strictEqual(storeB.chunkCount, 0, 'workspace B must not see workspace A chunks');

			assert.ok(fs.existsSync(path.join(workspaceA, 'rag-index.json')), 'workspace A index persisted');
			assert.ok(!fs.existsSync(path.join(workspaceB, 'rag-index.json')), 'workspace B has no index file');
		});

		test('writing to one workspace does not mutate another already-persisted index', () => {
			const workspaceA = makeTempDir();
			const workspaceB = makeTempDir();

			const storeA = new JsonVectorStore(workspaceA);
			storeA.upsertChunk(makeChunk({ id: 'a-1' }));
			storeA.flush();

			const storeB = new JsonVectorStore(workspaceB);
			storeB.upsertChunk(makeChunk({ id: 'b-1', filePath: 'src/b.ts' }));
			storeB.upsertChunk(makeChunk({ id: 'b-2', filePath: 'src/b.ts' }));
			storeB.flush();

			const reopenedA = new JsonVectorStore(workspaceA);
			assert.strictEqual(reopenedA.chunkCount, 1);
			assert.deepStrictEqual(reopenedA.getIndexedFiles(), ['src/example.ts']);
		});

		test('creates a missing storage directory on flush (fresh workspaceStorage)', () => {
			const nested = path.join(makeTempDir(), 'workspaceStorage', 'abc123', 'publisher.extension');
			assert.ok(!fs.existsSync(nested));

			const store = new JsonVectorStore(nested);
			store.upsertChunk(makeChunk());
			store.flush();

			assert.ok(fs.existsSync(path.join(nested, 'rag-index.json')));
		});

		test('persists chunks across re-open from the same path', () => {
			const dir = makeTempDir();

			const store = new JsonVectorStore(dir);
			store.upsertChunk(makeChunk({ id: 'c-1' }));
			store.upsertChunk(makeChunk({ id: 'c-2', filePath: 'src/other.ts' }));
			store.flush();

			const reopened = new JsonVectorStore(dir);
			assert.strictEqual(reopened.chunkCount, 2);
			assert.strictEqual(reopened.getChunksForFile('src/other.ts').length, 1);
			assert.ok(reopened.updatedAt, 'updatedAt is preserved');
			assert.strictEqual(reopened.getAllChunks().length, 2);
		});

		test('removeFile deletes only the matching file\'s chunks', () => {
			const store = new JsonVectorStore(makeTempDir());
			store.upsertChunk(makeChunk({ id: 'r-1', filePath: 'src/a.ts' }));
			store.upsertChunk(makeChunk({ id: 'r-2', filePath: 'src/b.ts' }));

			store.removeFile('src/a.ts');
			assert.strictEqual(store.chunkCount, 1);
			assert.deepStrictEqual(store.getIndexedFiles(), ['src/b.ts']);

			// Removing a file with no chunks is a no-op.
			store.removeFile('src/missing.ts');
			assert.strictEqual(store.chunkCount, 1);
		});

		test('clear empties the index and persists the empty store', () => {
			const dir = makeTempDir();
			const store = new JsonVectorStore(dir);
			store.upsertChunk(makeChunk());
			store.flush();

			store.clear();
			assert.strictEqual(store.chunkCount, 0);
			assert.strictEqual(new JsonVectorStore(dir).chunkCount, 0);
		});

		test('flush without changes is a no-op', () => {
			const dir = makeTempDir();
			new JsonVectorStore(dir).flush();
			assert.ok(!fs.existsSync(path.join(dir, 'rag-index.json')));
		});

		test('starts fresh on corrupt or incompatible index files', () => {
			const corruptDir = makeTempDir();
			fs.writeFileSync(path.join(corruptDir, 'rag-index.json'), '{not valid json', 'utf8');
			assert.strictEqual(new JsonVectorStore(corruptDir).chunkCount, 0);

			const staleDir = makeTempDir();
			fs.writeFileSync(
				path.join(staleDir, 'rag-index.json'),
				JSON.stringify({ version: 999, chunks: { x: makeChunk() }, chunkCount: 1, updatedAt: '' }),
				'utf8',
			);
			assert.strictEqual(new JsonVectorStore(staleDir).chunkCount, 0);
		});
	});

	// ─── resolveRagStoragePath ───────────────────────────────────────────────

	suite('resolveRagStoragePath', () => {
		const workspaceUri = { fsPath: '/home/user/.vscode/workspaceStorage/abc/ext' };
		const globalUri = { fsPath: '/home/user/.vscode/globalStorage/ext' };

		test('prefers workspace-scoped storageUri when a workspace is open', () => {
			const resolved = resolveRagStoragePath({
				storageUri: workspaceUri,
				globalStorageUri: globalUri,
			} as never);
			assert.strictEqual(resolved, workspaceUri.fsPath);
		});

		test('falls back to globalStorageUri when no workspace is open', () => {
			const resolved = resolveRagStoragePath({
				storageUri: undefined,
				globalStorageUri: globalUri,
			} as never);
			assert.strictEqual(resolved, globalUri.fsPath);
		});
	});

	// ─── getRagConfig ────────────────────────────────────────────────────────

	suite('getRagConfig', () => {
		test('returns defaults when no settings are configured', () => {
			assert.deepStrictEqual(getRagConfig(), DEFAULT_RAG_CONFIG);
		});
	});
});
