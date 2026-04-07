import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpBridge } from '../context';
import { filterDiff, getDiffFilterConfig } from '../../diffFilter';
import { gatherContext, formatContextForPrompt, getContextGatheringConfig } from '../../context';
import { loadKnowledgeBase, getKnowledgeBaseConfig, formatKnowledgeForPrompt, matchKnowledge } from '../../knowledge';
import { loadRulesDirectory } from '../../rules/loader';
import { getActiveProfile, buildProfilePromptContext } from '../../profiles';
import { getEffectiveFrameworks } from '../../config/promptLoader';
import { buildReviewPrompt, type ReviewPromptMode } from '../../reviewPromptBuilder';

async function buildPromptBundleForDiff(
	diff: string,
	promptMode: ReviewPromptMode = 'default',
	lightCheckCriteria: string[] = [],
): Promise<{
	filteredDiff: string;
	promptText: string;
	stats: ReturnType<typeof filterDiff>['stats'];
}> {
	const filterConfig = getDiffFilterConfig();
	const result = filterDiff(diff, filterConfig);
	const filteredDiff = result.filteredDiff;
	if (!filteredDiff.trim()) {
		throw new Error('All changes were filtered out. No reviewable diff remains.');
	}

	let contextBundle;
	try {
		const ctxConfig = getContextGatheringConfig();
		if (ctxConfig.enabled) {
			contextBundle = await gatherContext(filteredDiff, ctxConfig, mcpBridge.channel || undefined);
		}
	} catch (err) {
		mcpBridge.log(`get_review_prompt context gathering error: ${String(err)}`);
	}

	const promptText = await buildReviewPrompt({
		context: mcpBridge.context,
		contextBundle,
		diff: filteredDiff,
		outputChannel: mcpBridge.channel || undefined,
		promptMode,
		lightCheckCriteria,
	});

	return {
		filteredDiff,
		promptText,
		stats: result.stats,
	};
}

export function registerContextTools(server: McpServer): void {

	server.tool(
		'get_review_context',
		'Gather all review context for the staged diff: related files (imports, tests, types), team knowledge base entries, rules, active profile, and frameworks. Returns structured JSON — no AI calls.',
		{
			repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
		},
		async ({ repository_path }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log('get_review_context');

			// Get staged diff
			const rawDiff = await mcpBridge.runGit(repoPath, ['diff', '--staged']);
			if (!rawDiff.trim()) {
				return { content: [{ type: 'text' as const, text: 'No staged changes found.' }] };
			}

			const filterConfig = getDiffFilterConfig();
			const { filteredDiff } = filterDiff(rawDiff, filterConfig);

			const contextResult: Record<string, unknown> = {};

			// 1. Gather related files (imports, tests, type definitions)
			try {
				const ctxConfig = getContextGatheringConfig();
				if (ctxConfig.enabled) {
					const bundle = await gatherContext(filteredDiff, ctxConfig, mcpBridge.channel || undefined);
					contextResult.relatedFiles = {
						files: bundle.files.map(f => ({
							path: f.relativePath,
							reason: f.reason,
							sourceFile: f.sourceFile,
							charCount: f.charCount,
							content: f.content,
						})),
						summary: bundle.summary,
						stats: bundle.stats,
					};
				}
			} catch (err) {
				contextResult.relatedFiles = { error: String(err) };
			}

			// 2. Knowledge base (decisions, patterns, rules)
			try {
				const kbConfig = getKnowledgeBaseConfig();
				if (kbConfig.enabled) {
					const knowledge = await loadKnowledgeBase(mcpBridge.channel || undefined);
					if (knowledge) {
						const matchResult = matchKnowledge(knowledge, filteredDiff, kbConfig.maxEntries);
						contextResult.knowledgeBase = {
							matches: matchResult.matches,
							totalEntries: matchResult.totalEntries,
							raw: knowledge,
						};
					}
				}
			} catch (err) {
				contextResult.knowledgeBase = { error: String(err) };
			}

			// 3. Rules directory (.ollama-review/rules/*.md)
			try {
				const rules = await loadRulesDirectory(mcpBridge.channel || undefined);
				if (rules) {
					contextResult.rules = rules;
				}
			} catch (err) {
				contextResult.rules = { error: String(err) };
			}

			// 4. Active review profile
			try {
				const profile = getActiveProfile(mcpBridge.context);
				contextResult.profile = {
					name: profile.name,
					description: profile.description,
					focusAreas: profile.focusAreas,
					severity: profile.severity,
					includeExplanations: profile.includeExplanations,
					promptContext: buildProfilePromptContext(profile),
				};
			} catch (err) {
				contextResult.profile = { error: String(err) };
			}

			// 5. Frameworks
			try {
				const frameworks = await getEffectiveFrameworks(mcpBridge.channel || undefined);
				contextResult.frameworks = frameworks;
			} catch (err) {
				contextResult.frameworks = { error: String(err) };
			}

			// 6. Skills (if any selected)
			try {
				const selectedSkills = mcpBridge.context.globalState.get<any[]>('selectedSkills', []);
				if (selectedSkills && selectedSkills.length > 0) {
					contextResult.skills = selectedSkills.map(s => ({
						name: s.name,
						description: s.description,
						content: s.content,
						repository: s.repository,
					}));
				}
			} catch {
				// Non-fatal
			}

			return {
				content: [{
					type: 'text' as const,
					text: JSON.stringify(contextResult, null, 2),
				}],
			};
		},
	);

	server.tool(
		'get_review_prompt',
		'Assemble the complete review prompt with all context (profile, knowledge base, rules, frameworks, related files) injected. Returns the fully built prompt that can be used directly for AI analysis. No AI calls are made.',
		{
			repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
		},
		async ({ repository_path }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log('get_review_prompt');

			const rawDiff = await mcpBridge.runGit(repoPath, ['diff', '--staged']);
			if (!rawDiff.trim()) {
				return { content: [{ type: 'text' as const, text: 'No staged changes found.' }] };
			}

			const bundle = await buildPromptBundleForDiff(rawDiff, 'default');
			return { content: [{ type: 'text' as const, text: bundle.promptText }] };
		},
	);

	server.tool(
		'get_staged_review_bundle',
		'Build the staged-review input bundle for browser or agent clients. Returns JSON with the filtered staged diff and the fully built review prompt. No AI calls are made.',
		{
			repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
		},
		async ({ repository_path }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log(`get_staged_review_bundle: repo=${repoPath}`);

			const rawDiff = await mcpBridge.runGit(repoPath, ['diff', '--staged']);
			if (!rawDiff.trim()) {
				return { content: [{ type: 'text' as const, text: 'No staged changes found.' }] };
			}

			const bundle = await buildPromptBundleForDiff(rawDiff);
			return {
				content: [{
					type: 'text' as const,
					text: JSON.stringify(bundle, null, 2),
				}],
			};
		},
	);

	server.tool(
		'get_branch_review_bundle',
		'Build the branch-review input bundle for browser or agent clients. Returns JSON with the filtered branch diff and the fully built review prompt. No AI calls are made.',
		{
			base_ref: z.string().describe('The base branch or ref to compare from (e.g., main)'),
			target_ref: z.string().describe('The target branch or ref to compare to (e.g., feature-branch)'),
			prompt_mode: z.enum(['default', 'light-check']).optional().describe('Optional prompt mode to tailor the review prompt for the client workflow.'),
			light_check_criteria: z.array(z.string()).optional().describe('Optional light-check criteria supplied by the client UI.'),
			repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
		},
		async ({ base_ref, target_ref, prompt_mode, light_check_criteria, repository_path }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log(`get_branch_review_bundle: base=${base_ref}, target=${target_ref}, repo=${repoPath}`);

			const rawDiff = await mcpBridge.runGit(repoPath, ['diff', base_ref, target_ref]);
			if (!rawDiff.trim()) {
				return {
					content: [{ type: 'text' as const, text: `No differences found between ${base_ref} and ${target_ref}.` }],
				};
			}

			const bundle = await buildPromptBundleForDiff(rawDiff, prompt_mode ?? 'default', light_check_criteria ?? []);
			return {
				content: [{
					type: 'text' as const,
					text: JSON.stringify(bundle, null, 2),
				}],
			};
		},
	);

	server.tool(
		'get_commit_review_bundle',
		'Build the commit-review input bundle for browser or agent clients. Returns JSON with the filtered commit diff, commit message, and the fully built review prompt. No AI calls are made.',
		{
			commit_sha: z.string().describe('The commit SHA to review'),
			repository_path: z.string().optional().describe('Path to the git repository. Defaults to the open workspace folder.'),
		},
		async ({ commit_sha, repository_path }) => {
			const repoPath = repository_path || mcpBridge.getRepoPath();
			mcpBridge.log(`get_commit_review_bundle: sha=${commit_sha}, repo=${repoPath}`);

			const rawDiff = await mcpBridge.runGit(repoPath, ['show', commit_sha, '--format=']);
			if (!rawDiff.trim()) {
				return {
					content: [{
						type: 'text' as const,
						text: JSON.stringify({
							commitSha: commit_sha,
							commitMessage: '',
							filteredDiff: '',
							promptText: '',
							error: `Commit ${commit_sha} has no changes.`,
						}, null, 2),
					}],
				};
			}

			const commitMessage = (await mcpBridge.runGit(repoPath, ['log', '--format=%B', '-n', '1', commit_sha])).trim();
			const bundle = await buildPromptBundleForDiff(rawDiff);

			return {
				content: [{
					type: 'text' as const,
					text: JSON.stringify({
						commitSha: commit_sha,
						commitMessage,
						...bundle,
					}, null, 2),
				}],
			};
		},
	);
}
