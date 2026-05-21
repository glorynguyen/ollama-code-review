import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { mcpBridge } from '../context';
import { sembleService } from '../sembleService';
import { codeSearchRegistry, type IndexedCodebase } from '../codeSearchRegistry';
import { resolveAndValidatePath } from '../../utils/pathValidation';

function getWorkspaceRootsSafe(): string[] {
	try {
		return mcpBridge.getWorkspaceRoots();
	} catch {
		return [];
	}
}

async function ensureDirectory(filePath: string, originalPath: string): Promise<string> {
	const resolvedPath = await fs.realpath(filePath).catch(() => path.resolve(filePath));
	const stat = await fs.stat(resolvedPath);
	if (!stat.isDirectory()) {
		throw new Error(`Repository path must be a directory: ${originalPath}`);
	}
	return resolvedPath;
}

async function resolveWorkspaceRepositoryPath(repositoryPath?: string): Promise<string> {
	const roots = mcpBridge.getWorkspaceRoots();
	const targetPath = repositoryPath || roots[0];
	const validation = await resolveAndValidatePath(targetPath, roots);
	if (!validation.valid) {
		throw new Error(validation.error);
	}
	return ensureDirectory(validation.resolvedPath, targetPath);
}

async function resolveIndexRepositoryPath(repositoryPath?: string): Promise<string> {
	if (!repositoryPath) {
		return resolveWorkspaceRepositoryPath();
	}

	if (path.isAbsolute(repositoryPath)) {
		return ensureDirectory(repositoryPath, repositoryPath);
	}

	const roots = getWorkspaceRootsSafe();
	if (roots.length > 0) {
		return resolveWorkspaceRepositoryPath(repositoryPath);
	}

	throw new Error('repository_path must be absolute when no VS Code workspace is open.');
}

async function resolveSearchRepositoryPath(repositoryPath?: string): Promise<string> {
	if (!repositoryPath) {
		return resolveWorkspaceRepositoryPath();
	}

	const registeredPath = await codeSearchRegistry.resolveRegisteredPath(repositoryPath);
	if (!registeredPath) {
		const roots = getWorkspaceRootsSafe();
		if (roots.length > 0) {
			const validation = await resolveAndValidatePath(repositoryPath, roots);
			if (validation.valid) {
				return ensureDirectory(validation.resolvedPath, repositoryPath);
			}
		}
		throw new Error(`Repository is not indexed for code search: ${repositoryPath}. Run index_codebase first or choose a repository from list_indexed_codebases.`);
	}
	return registeredPath;
}

async function readSnippetFromFile(
	repositoryPath: string,
	filePath: string,
	startLine?: number,
	endLine?: number,
): Promise<string> {
	const absolutePath = path.isAbsolute(filePath)
		? filePath
		: path.join(repositoryPath, filePath);
	const validation = await resolveAndValidatePath(absolutePath, repositoryPath);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	const text = await fs.readFile(validation.resolvedPath, 'utf8');
	if (!startLine && !endLine) {
		return text;
	}

	const lines = text.split(/\r?\n/);
	const start = Math.max((startLine ?? 1) - 1, 0);
	const end = Math.min(endLine ?? lines.length, lines.length);
	return lines.slice(start, end).join('\n');
}

function clampTopK(topK: number | undefined): number {
	if (!topK || !Number.isFinite(topK)) {
		return 5;
	}
	return Math.max(1, Math.min(Math.floor(topK), 20));
}

function jsonContent(value: unknown) {
	return {
		content: [{
			type: 'text' as const,
			text: JSON.stringify(value, null, 2),
		}],
	};
}

function errorContent(error: unknown) {
	return {
		content: [{
			type: 'text' as const,
			text: error instanceof Error ? error.message : String(error),
		}],
		isError: true,
	};
}

function mergeIndexedCodebases(statusIndexes: IndexedCodebase[], registeredIndexes: IndexedCodebase[]): IndexedCodebase[] {
	const byPath = new Map<string, IndexedCodebase>();
	for (const index of registeredIndexes) {
		byPath.set(index.repositoryPath, index);
	}
	for (const index of statusIndexes) {
		byPath.set(index.repositoryPath, {
			...byPath.get(index.repositoryPath),
			...index,
		});
	}
	return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name) || a.repositoryPath.localeCompare(b.repositoryPath));
}

export function registerSembleTools(server: McpServer): void {
	server.registerTool(
		'index_codebase',
		{
			description: 'Index a repository with Semble and register it so MCP clients can perform fast local code search. Requires `pip install semble` in the configured Python environment.',
			inputSchema: {
				repository_path: z.string().optional().describe('Absolute or workspace-relative repository path. Defaults to the first open workspace folder. Absolute paths are registered for future search.'),
			},
		},
		async ({ repository_path }) => {
			try {
				const repositoryPath = await resolveIndexRepositoryPath(repository_path);
				mcpBridge.log(`index_codebase: repo=${repositoryPath}`);
				const result = await sembleService.indexRepository(repositoryPath);
				await codeSearchRegistry.upsertFromIndex(result);
				return jsonContent(result);
			} catch (err) {
				return errorContent(err);
			}
		},
	);

	server.registerTool(
		'search_code',
		{
			description: 'Search a Semble-indexed codebase with a natural-language or code query. Defaults to the first open workspace folder when repository_path is omitted.',
			inputSchema: {
				query: z.string().min(1).describe('Natural-language or code query, such as "save model to disk" or "parseConfig".'),
				top_k: z.number().min(1).max(20).optional().describe('Maximum number of code snippets to return. Defaults to 5.'),
				repository_path: z.string().optional().describe('Absolute registered repository path, or a path inside the open VS Code workspace for legacy auto-index behavior.'),
			},
		},
		async ({ query, top_k, repository_path }) => {
			try {
				const repositoryPath = await resolveSearchRepositoryPath(repository_path);
				mcpBridge.log(`search_code: repo=${repositoryPath}, query=${query}`);
				const results = await sembleService.search(repositoryPath, query, clampTopK(top_k));
				await codeSearchRegistry.markUsed(repositoryPath);
				return jsonContent({
					repositoryPath,
					query,
					results,
				});
			} catch (err) {
				return errorContent(err);
			}
		},
	);

	server.registerTool(
		'find_related_code',
		{
			description: 'Find code chunks related to a provided snippet or to a file/range in a Semble-indexed codebase.',
			inputSchema: {
				snippet: z.string().optional().describe('Code snippet to use as the similarity seed. If omitted, file_path is required.'),
				file_path: z.string().optional().describe('Absolute or repository-relative file path to use as the similarity seed when snippet is omitted.'),
				start_line: z.number().min(1).optional().describe('Optional 1-based start line for file_path.'),
				end_line: z.number().min(1).optional().describe('Optional 1-based end line for file_path.'),
				top_k: z.number().min(1).max(20).optional().describe('Maximum number of related snippets to return. Defaults to 5.'),
				repository_path: z.string().optional().describe('Absolute registered repository path, or a path inside the open VS Code workspace for legacy auto-index behavior.'),
			},
		},
		async ({ snippet, file_path, start_line, end_line, top_k, repository_path }) => {
			try {
				const repositoryPath = await resolveSearchRepositoryPath(repository_path);
				const seed = snippet?.trim()
					? snippet
					: file_path
						? await readSnippetFromFile(repositoryPath, file_path, start_line, end_line)
						: '';

				if (!seed.trim()) {
					return errorContent('Provide either a non-empty snippet or a file_path to find related code.');
				}

				mcpBridge.log(`find_related_code: repo=${repositoryPath}`);
				const results = await sembleService.findRelated(repositoryPath, seed, clampTopK(top_k));
				await codeSearchRegistry.markUsed(repositoryPath);
				return jsonContent({
					repositoryPath,
					seed: snippet?.trim() ? { source: 'snippet' } : { source: 'file', filePath: file_path, startLine: start_line, endLine: end_line },
					results,
				});
			} catch (err) {
				return errorContent(err);
			}
		},
	);

	server.registerTool(
		'list_indexed_codebases',
		{
			description: 'List repositories that have been indexed and can be selected for Semble-backed code search.',
			inputSchema: undefined,
		},
		async () => {
			try {
				const status = await sembleService.getStatus();
				await codeSearchRegistry.upsertFromStatus(status);
				return jsonContent({
					codebases: await codeSearchRegistry.list(),
				});
			} catch (err) {
				return errorContent(err);
			}
		},
	);

	server.registerTool(
		'resolve_codebase_repository',
		{
			description: 'Resolve a client working directory to the best indexed codebase. Use this before search_code when the client wants automatic repo selection.',
			inputSchema: {
				working_directory: z.string().min(1).describe('Absolute current working directory from the MCP client.'),
			},
		},
		async ({ working_directory }) => {
			try {
				return jsonContent(await codeSearchRegistry.resolveForWorkingDirectory(working_directory));
			} catch (err) {
				return errorContent(err);
			}
		},
	);

	server.registerTool(
		'get_code_search_status',
		{
			description: 'Report Semble availability and the repositories available for code search from worker memory and the persistent indexed-codebase registry.',
			inputSchema: undefined,
		},
		async () => {
			try {
				const status = await sembleService.getStatus();
				await codeSearchRegistry.upsertFromStatus(status);
				const registeredIndexes = await codeSearchRegistry.list();
				return jsonContent({
					...status,
					indexes: mergeIndexedCodebases(status.indexes.map(index => ({
						...index,
						name: path.basename(index.repositoryPath) || index.repositoryPath,
					})), registeredIndexes),
				});
			} catch (err) {
				return errorContent(err);
			}
		},
	);
}
