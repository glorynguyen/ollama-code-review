import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpBridge } from '../context';
import { filterDiff, getDiffFilterConfig } from '../../diffFilter';
import { gatherContext, formatContextForPrompt, getContextGatheringConfig } from '../../context';
import { loadKnowledgeBase, getKnowledgeBaseConfig, formatKnowledgeForPrompt, matchKnowledge } from '../../knowledge';
import { loadRulesDirectory } from '../../rules/loader';
import { getActiveProfile, buildProfilePromptContext } from '../../profiles';
import { getEffectiveReviewPrompt, getEffectiveFrameworks } from '../../config/promptLoader';
import { resolvePrompt } from '../../utils';

const DEFAULT_REVIEW_PROMPT = "You are an expert software engineer and code reviewer with deep knowledge of the following frameworks and libraries: **${frameworks}**.\nYour task is to analyze the following code changes (in git diff format) and provide constructive, actionable feedback tailored to the conventions, best practices, and common pitfalls of these technologies.\n${skills}\n${profile}\n**How to Read the Git Diff Format:**\n- Lines starting with `---` and `+++` indicate the file names before and after the changes.\n- Lines starting with `@@` (e.g., `@@ -15,7 +15,9 @@`) denote the location of the changes within the file.\n- Lines starting with a `-` are lines that were DELETED.\n- Lines starting with a `+` are lines that were ADDED.\n- Lines without a prefix (starting with a space) are for context and have not been changed. **Please focus your review on the added (`+`) and deleted (`-`) lines.**\n\n**Review Focus:**\n- Potential bugs or logical errors specific to the frameworks/libraries (${frameworks}).\n- Performance optimizations, considering framework-specific patterns.\n- Code style inconsistencies or deviations from ${frameworks} best practices.\n- Security vulnerabilities, especially those common in ${frameworks}.\n- Improvements to maintainability and readability, aligned with ${frameworks} conventions.\n\n**Feedback Requirements:**\n1. Explain any issues clearly and concisely, referencing ${frameworks} where relevant.\n2. Suggest specific code changes or improvements. Include code snippets for examples where appropriate.\n3. Use Markdown for clear formatting.\n\nIf you find no issues, please respond with the single sentence: \"I have reviewed the changes and found no significant issues.\"\n\nHere is the code diff to review:\n---\n${code}\n---";

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

			// Get staged diff
			const rawDiff = await mcpBridge.runGit(repoPath, ['diff', '--staged']);
			if (!rawDiff.trim()) {
				return { content: [{ type: 'text' as const, text: 'No staged changes found.' }] };
			}

			const filterConfig = getDiffFilterConfig();
			const { filteredDiff } = filterDiff(rawDiff, filterConfig);

			// Gather all context sections
			const frameworksList = (await getEffectiveFrameworks(mcpBridge.channel || undefined)).join(', ');

			let skillContext = '';
			try {
				const selectedSkills = mcpBridge.context.globalState.get<any[]>('selectedSkills', []);
				if (selectedSkills?.length > 0) {
					const skillContents = selectedSkills.map((skill: any, i: number) =>
						`### Skill ${i + 1}: ${skill.name}\n${skill.content}`
					).join('\n\n');
					skillContext = `\n\nAdditional Review Guidelines (${selectedSkills.length} skill(s) applied):\n${skillContents}\n`;
				}
			} catch { /* ignore */ }

			let profileContext = '';
			try {
				const profile = getActiveProfile(mcpBridge.context);
				profileContext = buildProfilePromptContext(profile);
			} catch { /* ignore */ }

			// Resolve prompt template
			const promptTemplate = await getEffectiveReviewPrompt(DEFAULT_REVIEW_PROMPT, mcpBridge.channel || undefined);
			const variables: Record<string, string> = {
				code: filteredDiff,
				frameworks: frameworksList,
				skills: skillContext,
				profile: profileContext,
			};
			let prompt = resolvePrompt(promptTemplate, variables);

			// Append skills if template omits ${skills}
			if (skillContext && !promptTemplate.includes('${skills}')) {
				prompt += '\n' + skillContext;
			}

			// Append context files
			try {
				const ctxConfig = getContextGatheringConfig();
				if (ctxConfig.enabled) {
					const bundle = await gatherContext(filteredDiff, ctxConfig, mcpBridge.channel || undefined);
					if (bundle.files.length > 0) {
						prompt += '\n' + formatContextForPrompt(bundle);
					}
				}
			} catch { /* non-fatal */ }

			// Append profile if template omits ${profile}
			if (profileContext && !promptTemplate.includes('${profile}')) {
				prompt += '\n' + profileContext;
			}

			// Append knowledge base
			try {
				const kbConfig = getKnowledgeBaseConfig();
				if (kbConfig.enabled) {
					const knowledge = await loadKnowledgeBase(mcpBridge.channel || undefined);
					if (knowledge) {
						const matchResult = matchKnowledge(knowledge, filteredDiff, kbConfig.maxEntries);
						if (matchResult.matches.length > 0) {
							const section = formatKnowledgeForPrompt(knowledge, kbConfig.maxEntries);
							if (section) { prompt += section; }
						}
					}
				}
			} catch { /* non-fatal */ }

			// Append rules
			try {
				const rulesSection = await loadRulesDirectory(mcpBridge.channel || undefined);
				if (rulesSection) { prompt += rulesSection; }
			} catch { /* non-fatal */ }

			return { content: [{ type: 'text' as const, text: prompt }] };
		},
	);
}
