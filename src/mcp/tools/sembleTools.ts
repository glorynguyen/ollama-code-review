import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { mcpBridge } from '../context';
import { sembleService } from '../sembleService';
import { resolveAndValidatePath } from '../../utils/pathValidation';

async function resolveRepositoryPath(repositoryPath?: string): Promise<string> {
	const roots = mcpBridge.getWorkspaceRoots();
	const targetPath = repositoryPath || roots[0];
	const validation = await resolveAndValidatePath(targetPath, roots);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	const stat = await fs.stat(validation.resolvedPath);
	if (!stat.isDirectory()) {
		throw new Error(`Repository path must be a directory: ${targetPath}`);
	}

	return validation.resolvedPath;
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

export function registerSembleTools(server: McpServer): void {
	server.registerTool(
		'index_codebase',
		{
			description: 'Index the current workspace with Semble so MCP clients can perform fast local code search. Requires `pip install semble` in the configured Python environment.',
			inputSchema: {
				repository_path: z.string().optional().describe('Absolute or workspace-relative repository path. Defaults to the first open workspace folder. Must stay inside an open workspace.'),
			},
		},
		async ({ repository_path }) => {
			try {
				const repositoryPath = await resolveRepositoryPath(repository_path);
				mcpBridge.log(`index_codebase: repo=${repositoryPath}`);
				const result = await sembleService.indexRepository(repositoryPath);
				return jsonContent(result);
			} catch (err) {
				return errorContent(err);
			}
		},
	);

	server.registerTool(
		'search_code',
		{
			description: 'Search the indexed codebase with Semble using a natural-language or code query. Automatically indexes the repository on first use.',
			inputSchema: {
				query: z.string().min(1).describe('Natural-language or code query, such as "save model to disk" or "parseConfig".'),
				top_k: z.number().min(1).max(20).optional().describe('Maximum number of code snippets to return. Defaults to 5.'),
				repository_path: z.string().optional().describe('Absolute or workspace-relative repository path. Defaults to the first open workspace folder. Must stay inside an open workspace.'),
			},
		},
		async ({ query, top_k, repository_path }) => {
			try {
				const repositoryPath = await resolveRepositoryPath(repository_path);
				mcpBridge.log(`search_code: repo=${repositoryPath}, query=${query}`);
				const results = await sembleService.search(repositoryPath, query, clampTopK(top_k));
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
			description: 'Find code chunks related to a provided snippet or to a file/range in the current workspace using Semble.',
			inputSchema: {
				snippet: z.string().optional().describe('Code snippet to use as the similarity seed. If omitted, file_path is required.'),
				file_path: z.string().optional().describe('Absolute or repository-relative file path to use as the similarity seed when snippet is omitted.'),
				start_line: z.number().min(1).optional().describe('Optional 1-based start line for file_path.'),
				end_line: z.number().min(1).optional().describe('Optional 1-based end line for file_path.'),
				top_k: z.number().min(1).max(20).optional().describe('Maximum number of related snippets to return. Defaults to 5.'),
				repository_path: z.string().optional().describe('Absolute or workspace-relative repository path. Defaults to the first open workspace folder. Must stay inside an open workspace.'),
			},
		},
		async ({ snippet, file_path, start_line, end_line, top_k, repository_path }) => {
			try {
				const repositoryPath = await resolveRepositoryPath(repository_path);
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
		'get_code_search_status',
		{
			description: 'Report Semble availability and the repositories currently indexed in the extension MCP worker.',
			inputSchema: undefined,
		},
		async () => {
			try {
				const status = await sembleService.getStatus();
				return jsonContent(status);
			} catch (err) {
				return errorContent(err);
			}
		},
	);
}
