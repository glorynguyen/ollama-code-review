import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { JsonVectorStore } from '../rag/vectorStore';
import type { CodeChunk } from '../rag/types';

const EXTENSION_ID = 'VinhNguyen-Vincent.ollama-code-review';

suite('RAG Storage Integration Test Suite', () => {
	let ragStoragePath: string;

	suiteSetup(async function () {
		this.timeout(60000);
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `Extension ${EXTENSION_ID} not found in test host`);
		const exports = await extension.activate();
		assert.ok(exports?.ragStoragePath, 'activate() must export ragStoragePath');
		ragStoragePath = exports.ragStoragePath;
	});

	test('RAG storage resolves to workspace-scoped storage, not global storage', () => {
		assert.ok(
			vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0,
			'test harness must open a workspace folder',
		);
		assert.ok(
			ragStoragePath.includes('workspaceStorage'),
			`expected workspace-scoped path, got: ${ragStoragePath}`,
		);
		assert.ok(
			!ragStoragePath.includes('globalStorage'),
			`must not resolve to global storage, got: ${ragStoragePath}`,
		);
	});

	test('rag-index.json is writable under the workspace storage directory', () => {
		const chunk: CodeChunk = {
			id: 'integration-test-chunk',
			filePath: 'src/integration.ts',
			startLine: 1,
			endLine: 5,
			content: 'export const integration = true;',
			embedding: [1, 0, 0],
			indexedAt: new Date().toISOString(),
		};

		const store = new JsonVectorStore(ragStoragePath);
		store.upsertChunk(chunk);
		store.flush();

		const indexFile = path.join(ragStoragePath, 'rag-index.json');
		assert.ok(fs.existsSync(indexFile), `rag-index.json not written at ${indexFile}`);

		const reopened = new JsonVectorStore(ragStoragePath);
		assert.ok(reopened.chunkCount >= 1, 'persisted chunk must survive re-open');

		// Clean up so repeated test runs (and real indexing) start from a known state.
		reopened.removeFile('src/integration.ts');
		reopened.flush();
	});
});
