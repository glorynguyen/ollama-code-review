import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpBridge } from '../context';
import { getEffectiveCommitPrompt } from '../../config/promptLoader';
import { filterDiff, getDiffFilterConfig } from '../../diffFilter';
import { resolvePrompt } from '../../utils';

const DEFAULT_COMMIT_MESSAGE_PROMPT = "You are an expert at writing git commit messages for Semantic Release.\nGenerate a commit message based on the git diff below following the Conventional Commits specification.\n\n### Structural Requirements:\n1. **Subject Line**: <type>(<scope>): <short description>\n   - Keep under 50 characters.\n   - Use imperative mood (\"add\" not \"added\").\n   - Types: feat (new feature), fix (bug fix), docs, style, refactor, perf, test, build, ci, chore, revert.\n2. **Body**: Explain 'what' and 'why'. Required if the change is complex.\n3. **Breaking Changes**: If the diff contains breaking changes, the footer MUST start with \"BREAKING CHANGE:\" followed by a description.\n\n### Rules:\n- If the user's draft mentions a breaking change, prioritize documenting it in the footer.\n- Semantic Release triggers: 'feat' for MINOR, 'fix' for PATCH, and 'BREAKING CHANGE' in footer for MAJOR.\n- Output ONLY the raw commit message text. No markdown blocks, no \"Here is your message,\" no preamble.\n\nDeveloper's draft message (may reflect intent):\n${draftMessage}\n\nStaged git diff:\n---\n${diff}\n---";

async function buildCommitPromptBundle(diff: string, draftMessage: string) {
	const filterConfig = getDiffFilterConfig();
	const { filteredDiff } = filterDiff(diff, filterConfig);
	const effectiveDiff = filteredDiff.trim() ? filteredDiff : diff;
	const promptTemplate = await getEffectiveCommitPrompt(DEFAULT_COMMIT_MESSAGE_PROMPT, mcpBridge.channel || undefined);
	const promptText = resolvePrompt(promptTemplate, {
		diff: effectiveDiff,
		draftMessage,
	});

	return {
		draftMessage,
		diffText: effectiveDiff,
		promptText,
	};
}

export function registerCommitTools(server: McpServer): void {

	server.registerTool(
		'get_commit_prompt',
		{
			description: 'Assemble the full commit message prompt with the staged diff and template. Returns the prompt ready for AI analysis — no AI calls are made.',
			inputSchema: {
				repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
				existing_message: z.string().optional().describe('Optional draft message to refine'),
			},
		},
		async ({ repository_path, existing_message }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log(`get_commit_prompt: repo=${repoPath}`);

			const diff = await mcpBridge.runGit(repoPath, ['diff', '--staged']);
			if (!diff.trim()) {
				return { content: [{ type: 'text' as const, text: 'No staged changes found. Stage some changes with `git add` first.' }] };
			}

			const draftMessage = existing_message?.trim() || '(none provided)';
			const bundle = await buildCommitPromptBundle(diff, draftMessage);

			return { content: [{ type: 'text' as const, text: bundle.promptText }] };
		},
	);

	server.registerTool(
		'get_commit_prompt_bundle',
		{
			description: 'Assemble the commit message prompt bundle with a filtered staged diff. Returns JSON containing the final prompt, filtered diff, and draft message. No AI calls are made.',
			inputSchema: {
				repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
				existing_message: z.string().optional().describe('Optional draft message to refine'),
			},
		},
		async ({ repository_path, existing_message }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log(`get_commit_prompt_bundle: repo=${repoPath}`);

			const diff = await mcpBridge.runGit(repoPath, ['diff', '--staged']);
			if (!diff.trim()) {
				return {
					content: [{
						type: 'text' as const,
						text: JSON.stringify({
							promptText: '',
							diffText: '',
							draftMessage: existing_message?.trim() || '',
							error: 'No staged changes found. Stage some changes with `git add` first.',
						}, null, 2),
					}],
				};
			}

			const draftMessage = existing_message?.trim() || '(none provided)';
			const bundle = await buildCommitPromptBundle(diff, draftMessage);

			return {
				content: [{
					type: 'text' as const,
					text: JSON.stringify(bundle, null, 2),
				}],
			};
		},
	);

	server.registerTool(
		'set_commit_message',
		{
			description: 'Set the VS Code Source Control commit message input box for the selected repository.',
			inputSchema: {
				commit_message: z.string().describe('The commit message to place into the VS Code SCM input box'),
				repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
			},
		},
		async ({ commit_message, repository_path }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			const trimmedMessage = commit_message.trim();
			if (!trimmedMessage) {
				return { content: [{ type: 'text' as const, text: 'Commit message was empty. Nothing was written to the SCM input box.' }] };
			}

			await mcpBridge.setCommitMessage(repoPath, trimmedMessage);
			mcpBridge.log(`set_commit_message: repo=${repoPath}`);

			return {
				content: [{
					type: 'text' as const,
					text: `Commit message written to the VS Code SCM input box for ${repoPath}.`,
				}],
			};
		},
	);
}
