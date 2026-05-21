import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { registerSembleTools } from '../mcp/tools/sembleTools';
import { mcpBridge } from '../mcp/context';
import { sembleService, type SembleCodeSearchResult } from '../mcp/sembleService';

type ToolHandler = (args: any) => Promise<any>;

interface CapturedTool {
	name: string;
	config: unknown;
	handler: ToolHandler;
}

function createServer(): { tools: Map<string, CapturedTool>; server: any } {
	const tools = new Map<string, CapturedTool>();
	const server = {
		registerTool(name: string, config: unknown, handler: ToolHandler): void {
			tools.set(name, { name, config, handler });
		},
	};
	return { tools, server };
}

function readJsonContent(result: any): any {
	assert.strictEqual(result?.isError, undefined, result?.content?.[0]?.text);
	return JSON.parse(result.content[0].text);
}

suite('MCP Semble Tools Test Suite', () => {
	let tempRoot: string;
	let originalGetWorkspaceRoots: typeof mcpBridge.getWorkspaceRoots;
	let originalGetGlobalStoragePath: typeof mcpBridge.getGlobalStoragePath;
	let originalLog: typeof mcpBridge.log;
	let originalIndexRepository: typeof sembleService.indexRepository;
	let originalSearch: typeof sembleService.search;
	let originalFindRelated: typeof sembleService.findRelated;
	let originalGetStatus: typeof sembleService.getStatus;

	setup(async () => {
		tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-mcp-semble-tools-')));
		originalGetWorkspaceRoots = mcpBridge.getWorkspaceRoots;
		originalGetGlobalStoragePath = mcpBridge.getGlobalStoragePath;
		originalLog = mcpBridge.log;
		originalIndexRepository = sembleService.indexRepository;
		originalSearch = sembleService.search;
		originalFindRelated = sembleService.findRelated;
		originalGetStatus = sembleService.getStatus;

		(mcpBridge as any).getWorkspaceRoots = () => [tempRoot];
		(mcpBridge as any).getGlobalStoragePath = () => tempRoot;
		(mcpBridge as any).log = () => {};
	});

	teardown(async () => {
		(mcpBridge as any).getWorkspaceRoots = originalGetWorkspaceRoots;
		(mcpBridge as any).getGlobalStoragePath = originalGetGlobalStoragePath;
		(mcpBridge as any).log = originalLog;
		sembleService.indexRepository = originalIndexRepository;
		sembleService.search = originalSearch;
		sembleService.findRelated = originalFindRelated;
		sembleService.getStatus = originalGetStatus;
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	test('registers all Semble code search tools', () => {
		const { tools, server } = createServer();

		registerSembleTools(server);

		assert.deepStrictEqual([...tools.keys()], [
			'index_codebase',
			'search_code',
			'find_related_code',
			'list_indexed_codebases',
			'resolve_codebase_repository',
			'get_code_search_status',
		]);
	});

	test('index_codebase validates the repository path and returns index metadata', async () => {
		const { tools, server } = createServer();
		let indexedPath = '';
		sembleService.indexRepository = async (repositoryPath) => {
			indexedPath = repositoryPath;
			return {
				repositoryPath,
				chunkCount: 12,
				indexedAt: '2026-05-18T00:00:00Z',
				durationMs: 34,
			};
		};

		registerSembleTools(server);
		const result = await tools.get('index_codebase')!.handler({});
		const body = readJsonContent(result);

		assert.strictEqual(indexedPath, tempRoot);
		assert.deepStrictEqual(body, {
			repositoryPath: tempRoot,
			chunkCount: 12,
			indexedAt: '2026-05-18T00:00:00Z',
			durationMs: 34,
		});
	});

	test('search_code can search an explicitly indexed repository outside the open workspace', async () => {
		const { tools, server } = createServer();
		const externalRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-mcp-external-repo-')));
		const searchResults: SembleCodeSearchResult[] = [{
			filePath: 'src/external.ts',
			startLine: 1,
			endLine: 2,
			content: 'export const external = true;',
			score: 0.9,
		}];
		let searchedPath = '';

		sembleService.indexRepository = async (repositoryPath) => ({
			repositoryPath,
			chunkCount: 7,
			indexedAt: '2026-05-18T00:00:00Z',
			durationMs: 10,
		});
		sembleService.search = async (repositoryPath) => {
			searchedPath = repositoryPath;
			return searchResults;
		};

		try {
			registerSembleTools(server);
			await tools.get('index_codebase')!.handler({
				repository_path: externalRoot,
			});
			const result = await tools.get('search_code')!.handler({
				query: 'external',
				repository_path: externalRoot,
			});
			const body = readJsonContent(result);

			assert.strictEqual(searchedPath, externalRoot);
			assert.strictEqual(body.repositoryPath, externalRoot);
			assert.deepStrictEqual(body.results, searchResults);
		} finally {
			await fs.rm(externalRoot, { recursive: true, force: true });
		}
	});

	test('search_code clamps top_k and returns structured search results', async () => {
		const { tools, server } = createServer();
		let receivedTopK = 0;
		const searchResults: SembleCodeSearchResult[] = [{
			filePath: 'src/example.ts',
			startLine: 1,
			endLine: 2,
			content: 'export const answer = 42;',
			score: 0.9,
		}];
		sembleService.search = async (_repositoryPath, _query, topK) => {
			receivedTopK = topK;
			return searchResults;
		};

		registerSembleTools(server);
		const result = await tools.get('search_code')!.handler({
			query: 'answer constant',
			top_k: 99,
		});
		const body = readJsonContent(result);

		assert.strictEqual(receivedTopK, 20);
		assert.strictEqual(body.repositoryPath, tempRoot);
		assert.strictEqual(body.query, 'answer constant');
		assert.deepStrictEqual(body.results, searchResults);
	});

	test('search_code preserves explicit workspace repository fallback', async () => {
		const { tools, server } = createServer();
		let searchedPath = '';
		sembleService.search = async (repositoryPath) => {
			searchedPath = repositoryPath;
			return [];
		};

		registerSembleTools(server);
		const result = await tools.get('search_code')!.handler({
			query: 'workspace',
			repository_path: tempRoot,
		});
		const body = readJsonContent(result);

		assert.strictEqual(searchedPath, tempRoot);
		assert.strictEqual(body.repositoryPath, tempRoot);
	});

	test('find_related_code uses a snippet seed and floors top_k', async () => {
		const { tools, server } = createServer();
		let receivedSnippet = '';
		let receivedTopK = 0;
		sembleService.findRelated = async (_repositoryPath, snippet, topK) => {
			receivedSnippet = snippet;
			receivedTopK = topK;
			return [];
		};

		registerSembleTools(server);
		const result = await tools.get('find_related_code')!.handler({
			snippet: '  function target() {}',
			top_k: 2.9,
		});
		const body = readJsonContent(result);

		assert.strictEqual(receivedSnippet, '  function target() {}');
		assert.strictEqual(receivedTopK, 2);
		assert.deepStrictEqual(body.seed, { source: 'snippet' });
	});

	test('find_related_code can read a workspace file range as the seed', async () => {
		const { tools, server } = createServer();
		const filePath = path.join(tempRoot, 'src', 'example.ts');
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, ['line 1', 'line 2', 'line 3', 'line 4'].join('\n'), 'utf8');

		let receivedSnippet = '';
		sembleService.findRelated = async (_repositoryPath, snippet) => {
			receivedSnippet = snippet;
			return [];
		};

		registerSembleTools(server);
		const result = await tools.get('find_related_code')!.handler({
			file_path: 'src/example.ts',
			start_line: 2,
			end_line: 3,
		});
		const body = readJsonContent(result);

		assert.strictEqual(receivedSnippet, ['line 2', 'line 3'].join('\n'));
		assert.deepStrictEqual(body.seed, {
			source: 'file',
			filePath: 'src/example.ts',
			startLine: 2,
			endLine: 3,
		});
	});

	test('find_related_code rejects empty seed input', async () => {
		const { tools, server } = createServer();

		registerSembleTools(server);
		const result = await tools.get('find_related_code')!.handler({});

		assert.strictEqual(result.isError, true);
		assert.match(result.content[0].text, /Provide either a non-empty snippet or a file_path/);
	});

	test('get_code_search_status returns Semble availability metadata', async () => {
		const { tools, server } = createServer();
		sembleService.getStatus = async () => ({
			available: true,
			indexes: [{
				repositoryPath: tempRoot,
				chunkCount: 5,
				indexedAt: '2026-05-18T00:00:00Z',
			}],
		});

		registerSembleTools(server);
		const result = await tools.get('get_code_search_status')!.handler({});
		const body = readJsonContent(result);

		assert.strictEqual(body.available, true);
		assert.deepStrictEqual(body.indexes, [{
			repositoryPath: tempRoot,
			name: path.basename(tempRoot),
			chunkCount: 5,
			indexedAt: '2026-05-18T00:00:00Z',
		}]);
	});

	test('list_indexed_codebases returns registered repositories for client selection', async () => {
		const { tools, server } = createServer();
		sembleService.indexRepository = async (repositoryPath) => ({
			repositoryPath,
			chunkCount: 3,
			indexedAt: '2026-05-18T00:00:00Z',
			durationMs: 9,
		});
		sembleService.getStatus = async () => ({
			available: true,
			indexes: [],
		});

		registerSembleTools(server);
		await tools.get('index_codebase')!.handler({});
		const result = await tools.get('list_indexed_codebases')!.handler({});
		const body = readJsonContent(result);

		assert.deepStrictEqual(body.codebases, [{
			repositoryPath: tempRoot,
			name: path.basename(tempRoot),
			chunkCount: 3,
			indexedAt: '2026-05-18T00:00:00Z',
			lastUsedAt: body.codebases[0].lastUsedAt,
		}]);
		assert.strictEqual(typeof body.codebases[0].lastUsedAt, 'string');
	});

	test('resolve_codebase_repository auto-selects the longest indexed ancestor', async () => {
		const { tools, server } = createServer();
		const nestedRoot = path.join(tempRoot, 'packages', 'web');
		await fs.mkdir(nestedRoot, { recursive: true });
		sembleService.indexRepository = async (repositoryPath) => ({
			repositoryPath,
			chunkCount: 3,
			indexedAt: '2026-05-18T00:00:00Z',
			durationMs: 9,
		});

		registerSembleTools(server);
		await tools.get('index_codebase')!.handler({});
		await tools.get('index_codebase')!.handler({
			repository_path: nestedRoot,
		});

		const result = await tools.get('resolve_codebase_repository')!.handler({
			working_directory: path.join(nestedRoot, 'src'),
		});
		const body = readJsonContent(result);

		assert.strictEqual(body.selectedRepositoryPath, nestedRoot);
		assert.strictEqual(body.reason, 'cwd-inside-indexed-repo');
		assert.strictEqual(body.needsUserSelection, false);
	});

	test('search_code rejects explicit repositories that were not indexed first', async () => {
		const { tools, server } = createServer();
		const externalRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-mcp-unindexed-repo-')));

		try {
			registerSembleTools(server);
			const result = await tools.get('search_code')!.handler({
				query: 'unindexed',
				repository_path: externalRoot,
			});

			assert.strictEqual(result.isError, true);
			assert.match(result.content[0].text, /not indexed for code search/);
		} finally {
			await fs.rm(externalRoot, { recursive: true, force: true });
		}
	});
});
