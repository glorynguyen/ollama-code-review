import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpBridge } from '../context';
import { filterDiff, getDiffFilterConfig, getFilterSummary } from '../../diffFilter';

export function registerReviewTools(server: McpServer): void {

	server.tool(
		'get_staged_diff',
		'Get the staged Git diff, filtered to exclude noise (lock files, build output, minified files). Returns the cleaned diff and filter statistics.',
		{ repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.') },
		async ({ repository_path }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log(`get_staged_diff: repo=${repoPath}`);

			const rawDiff = await mcpBridge.runGit(repoPath, ['diff', '--staged']);
			if (!rawDiff.trim()) {
				return { content: [{ type: 'text' as const, text: 'No staged changes found. Stage some changes with `git add` first.' }] };
			}

			const filterConfig = getDiffFilterConfig();
			const result = filterDiff(rawDiff, filterConfig);
			const summary = getFilterSummary(result.stats);

			const output = [
				'## Staged Changes (Filtered)',
				'',
				`**Stats:** ${result.stats.includedFiles} of ${result.stats.totalFiles} files included`,
				summary ? `**Filtered:** ${summary}` : '',
				'',
				'```diff',
				result.filteredDiff,
				'```',
			].filter(Boolean).join('\n');

			return { content: [{ type: 'text' as const, text: output }] };
		},
	);

	server.tool(
		'get_commit_diff',
		'Get the diff of a specific Git commit, filtered to exclude noise.',
		{
			commit_sha: z.string().describe('The commit SHA to get the diff for'),
			repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
		},
		async ({ commit_sha, repository_path }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log(`get_commit_diff: sha=${commit_sha}, repo=${repoPath}`);

			const rawDiff = await mcpBridge.runGit(repoPath, ['show', commit_sha, '--format=']);
			if (!rawDiff.trim()) {
				return { content: [{ type: 'text' as const, text: `Commit ${commit_sha} has no changes.` }] };
			}

			// Also get the commit message
			const commitMsg = await mcpBridge.runGit(repoPath, ['log', '--format=%B', '-n', '1', commit_sha]);

			const filterConfig = getDiffFilterConfig();
			const result = filterDiff(rawDiff, filterConfig);
			const summary = getFilterSummary(result.stats);

			const output = [
				`## Commit ${commit_sha.substring(0, 8)}`,
				'',
				`**Message:** ${commitMsg.trim()}`,
				`**Stats:** ${result.stats.includedFiles} of ${result.stats.totalFiles} files included`,
				summary ? `**Filtered:** ${summary}` : '',
				'',
				'```diff',
				result.filteredDiff,
				'```',
			].filter(Boolean).join('\n');

			return { content: [{ type: 'text' as const, text: output }] };
		},
	);

	server.tool(
		'get_file_content',
		'Read a file from the workspace and return its content with language detection.',
		{
			file_path: z.string().describe('Absolute or workspace-relative path to the file'),
		},
		async ({ file_path }) => {
			mcpBridge.log(`get_file_content: path=${file_path}`);

			const fs = await import('fs/promises');
			const path = await import('path');

			// Resolve relative paths against workspace root
			let resolvedPath = file_path;
			if (!path.isAbsolute(file_path)) {
				resolvedPath = path.join(mcpBridge.getRepoPath(), file_path);
			}

			let content: string;
			try {
				content = await fs.readFile(resolvedPath, 'utf-8');
			} catch {
				return { content: [{ type: 'text' as const, text: `Could not read file: ${file_path}` }] };
			}

			const ext = path.extname(resolvedPath).replace('.', '');
			const langMap: Record<string, string> = {
				ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
				py: 'python', go: 'go', rs: 'rust', java: 'java', rb: 'ruby', php: 'php',
				cs: 'csharp', cpp: 'cpp', c: 'c', swift: 'swift', kt: 'kotlin',
				md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
				html: 'html', css: 'css', scss: 'scss', sql: 'sql', sh: 'shell',
			};
			const language = langMap[ext] || ext || 'plaintext';

			const output = [
				`## ${file_path}`,
				`**Language:** ${language} | **Lines:** ${content.split('\n').length}`,
				'',
				`\`\`\`${language}`,
				content,
				'```',
			].join('\n');

			return { content: [{ type: 'text' as const, text: output }] };
		},
	);
}
