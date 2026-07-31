import * as vscode from 'vscode';
import { formatContextForPrompt, type ContextBundle } from './context';
import { loadKnowledgeBase, getKnowledgeBaseConfig, formatKnowledgeForPrompt, matchKnowledge } from './knowledge';
import { loadRulesDirectory } from './rules/loader';
import { getActiveProfile, buildProfilePromptContext } from './profiles';
import { getEffectiveReviewPrompt, getEffectiveFrameworks } from './config/promptLoader';
import { resolvePrompt } from './utils';
import { getSkillsService } from './commands';
import {
	loadContentstackSchemas,
	getContentstackConfig,
	parseContentstackAccesses,
	validateFieldAccesses,
	buildContentstackPromptSection,
} from './contentstack';
import {
	loadSitecoreSchema,
	getSitecoreConfig,
	parseSitecoreFieldAccesses,
	validateSitecoreFieldAccesses,
	buildSitecorePromptSection,
	shouldEmitSitecoreSection,
} from './sitecore';
import type { SitecoreCodeParseResult, SitecoreFieldAccess } from './sitecore';

export const DEFAULT_REVIEW_PROMPT = "You are an expert software engineer and code reviewer with deep knowledge of the following frameworks and libraries: **${frameworks}**.\nYour task is to analyze the following code changes (in git diff format) and provide constructive, actionable feedback tailored to the conventions, best practices, and common pitfalls of these technologies.\n${skills}\n${profile}\n**How to Read the Git Diff Format:**\n- Lines starting with `---` and `+++` indicate the file names before and after the changes.\n- Lines starting with `@@` (e.g., `@@ -15,7 +15,9 @@`) denote the location of the changes within the file.\n- Lines starting with a `-` are lines that were DELETED.\n- Lines starting with a `+` are lines that were ADDED.\n- Lines without a prefix (starting with a space) are for context and have not been changed. **Please focus your review on the added (`+`) and deleted (`-`) lines.**\n\n**Review Focus:**\n- Potential bugs or logical errors specific to the frameworks/libraries (${frameworks}).\n- Performance optimizations, considering framework-specific patterns.\n- Code style inconsistencies or deviations from ${frameworks} best practices.\n- Security vulnerabilities, especially those common in ${frameworks}.\n- Improvements to maintainability and readability, aligned with ${frameworks} conventions.\n\n**Feedback Requirements:**\n1. Explain any issues clearly and concisely, referencing ${frameworks} where relevant.\n2. Suggest specific code changes or improvements. Include code snippets for examples where appropriate.\n3. Use Markdown for clear formatting.\n\n**Do Not Report Deterministic Build Issues:**\n- Do not report issues that TypeScript, ESLint, formatting, or the configured build step would deterministically catch, unless the diff provides full-file evidence that the build step is absent, disabled, or unreliable.\n- Do not infer that a symbol, export, import, type, or file is missing only because it is not shown in the diff.\n- Suppress missing exports, unresolved imports, TypeScript type errors, unused imports, formatting-only issues, and lint-only naming/style violations when the concern is only \"this might fail to compile\".\n\nIf you find no issues, please respond with the single sentence: \"I have reviewed the changes and found no significant issues.\"\n\nHere is the code diff to review:\n---\n${code}\n---";

export type ReviewPromptMode = 'default' | 'light-check';

export interface BuildReviewPromptOptions {
	context?: vscode.ExtensionContext;
	contextBundle?: ContextBundle;
	diff: string;
	outputChannel?: vscode.OutputChannel;
	promptMode?: ReviewPromptMode;
	lightCheckCriteria?: string[];
	impactContext?: string;
}

export async function buildReviewPrompt({
	context,
	contextBundle,
	diff,
	outputChannel,
	promptMode = 'default',
	lightCheckCriteria = [],
	impactContext,
}: BuildReviewPromptOptions): Promise<string> {
	const log = (message: string): void => {
		outputChannel?.appendLine(message);
	};

	const frameworksList = (await getEffectiveFrameworks(outputChannel)).join(', ');
	let skillContext = '';

	const skillsService = getSkillsService();
	if (skillsService) {
		const selectedSkills = skillsService.getEffectiveSkills();
		if (selectedSkills && selectedSkills.length > 0) {
			const skillContents = selectedSkills.map((skill, index) =>
				`### Skill ${index + 1}: ${skill.name}\n${skill.content}`
			).join('\n\n');
			skillContext = `\n\nAdditional Review Guidelines (${selectedSkills.length} skill(s) applied):\n${skillContents}\n`;
		}
	}

	let profileContext = '';
	if (context) {
		const profile = getActiveProfile(context);
		profileContext = buildProfilePromptContext(profile);
	}

	const promptTemplate = await getEffectiveReviewPrompt(DEFAULT_REVIEW_PROMPT, outputChannel);
	const variables: Record<string, string> = {
		code: diff,
		frameworks: frameworksList,
		skills: skillContext,
		profile: profileContext,
	};

	let prompt = resolvePrompt(promptTemplate, variables);

	if (skillContext && !promptTemplate.includes('${skills}')) {
		prompt += '\n' + skillContext;
	}

	if (contextBundle && contextBundle.files.length > 0) {
		const contextSection = formatContextForPrompt(contextBundle);
		prompt += '\n' + contextSection;
	}

	if (profileContext && !promptTemplate.includes('${profile}')) {
		prompt += '\n' + profileContext;
	}

	if (impactContext) {
		prompt += '\n\n## Downstream Architectural Impact\n' + impactContext;
	}

	if (promptMode === 'light-check') {
		const criteria = lightCheckCriteria.length > 0
			? lightCheckCriteria
			: ['Syntax issues', 'Naming convention problems', 'Security issues'];
		prompt += [
			'',
			'## Light-Check Constraints',
			'- This review is intentionally lightweight and may be reviewed in chunks.',
			'- Only check the changed code against the following criteria:',
			...criteria.map(criteriaItem => `  - ${criteriaItem}`),
			'- Do not report issues outside the selected criteria.',
			'- Do not infer hidden runtime bugs unless they are obvious from the diff itself.',
			'- If no issues matching the selected criteria are visible, respond that no significant issues were found for the selected light-check criteria.',
		].join('\n');
	}

	const kbConfig = getKnowledgeBaseConfig();
	if (kbConfig.enabled) {
		try {
			const knowledge = await loadKnowledgeBase(outputChannel);
			if (knowledge) {
				const matchResult = matchKnowledge(knowledge, diff, kbConfig.maxEntries);
				if (matchResult.matches.length > 0) {
					const knowledgeSection = formatKnowledgeForPrompt(knowledge, kbConfig.maxEntries);
					if (knowledgeSection) {
						prompt += knowledgeSection;
						log(`[Knowledge Base] Injected ${matchResult.matches.length} of ${matchResult.totalEntries} entries into review prompt.`);
					}
				}
			}
		} catch (err) {
			log(`[Knowledge Base] Error: ${err}`);
		}
	}

	try {
		const rulesSection = await loadRulesDirectory(outputChannel);
		if (rulesSection) {
			prompt += rulesSection;
		}
	} catch (err) {
		log(`[Rules] Error: ${err}`);
	}

	const csConfig = getContentstackConfig();
	if (csConfig.enabled) {
		try {
			const schemas = await loadContentstackSchemas(outputChannel);
			if (schemas && schemas.length > 0) {
				const parseResult = parseContentstackAccesses(diff, 'review-diff');
				if (parseResult.accesses.length > 0 || parseResult.contentTypeUids.length > 0) {
					const validation = validateFieldAccesses(parseResult, schemas);
					const csSection = buildContentstackPromptSection(validation, parseResult, csConfig);
					prompt += csSection;
					log(
						`[Contentstack] Schema validation: ${validation.stats.totalAccesses} field access(es), `
						+ `${validation.stats.invalidFields} potential mismatch(es), `
						+ `${validation.resolvedContentTypes.length} content type(s) resolved.`
					);
				}
			}
		} catch (err) {
			log(`[Contentstack] Error: ${err}`);
		}
	}

	// F-050: Sitecore Layout Service schema validation
	const scConfig = getSitecoreConfig();
	if (scConfig.enabled) {
		try {
			const schema = await loadSitecoreSchema(outputChannel);
			if (schema && Object.keys(schema.components).length > 0) {
				// Split diff by file so each chunk is parsed with its real
				// file path, enabling component-name inference from filenames.
				const diffFiles = _splitDiffByFile(diff);
				const allAccesses: SitecoreFieldAccess[] = [];
				const allComponentNames: string[] = [];

				for (const { filePath, content } of diffFiles) {
					const result = parseSitecoreFieldAccesses(content, filePath);
					allAccesses.push(...result.accesses);
					allComponentNames.push(...result.componentNames);
				}

				const parseResult: SitecoreCodeParseResult = {
					accesses: allAccesses,
					componentNames: [...new Set(allComponentNames)],
					filePath: 'review-diff',
				};

				if (parseResult.accesses.length > 0) {
					const validation = validateSitecoreFieldAccesses(parseResult, schema);
					// Every access was already checked deterministically above. When
					// nothing needs the model's judgement, skip the section entirely
					// rather than spend prompt tokens restating a clean result.
					if (shouldEmitSitecoreSection(validation, parseResult)) {
						prompt += buildSitecorePromptSection(validation, parseResult, schema, scConfig);
						log(
							`[Sitecore] Schema validation: ${validation.stats.totalAccesses} field access(es), `
							+ `${validation.stats.invalidFields} potential mismatch(es), `
							+ `${validation.resolvedComponents.length} component(s) resolved.`
						);
					} else {
						log(
							`[Sitecore] ${validation.stats.totalAccesses} field access(es) all validated clean — `
							+ 'prompt section skipped.'
						);
					}
				}
			}
		} catch (err) {
			log(`[Sitecore] Error: ${err}`);
		}
	}

	return prompt;
}

/**
 * Splits a unified diff into per-file chunks, extracting the real file path
 * from each `+++ b/...` header so parsers can infer component names from
 * the filename.
 */
function _splitDiffByFile(diff: string): Array<{ filePath: string; content: string }> {
	const files: Array<{ filePath: string; content: string }> = [];
	const chunks = diff.split(/^(?=diff --git )/m);

	for (const chunk of chunks) {
		if (!chunk.trim()) { continue; }

		const pathMatch = chunk.match(/^\+\+\+ b\/(.+)$/m);
		if (pathMatch) {
			files.push({ filePath: pathMatch[1], content: chunk });
		}
	}

	return files;
}
