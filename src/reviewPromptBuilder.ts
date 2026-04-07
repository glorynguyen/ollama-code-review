import * as vscode from 'vscode';
import { formatContextForPrompt, type ContextBundle } from './context';
import { loadKnowledgeBase, getKnowledgeBaseConfig, formatKnowledgeForPrompt, matchKnowledge } from './knowledge';
import { loadRulesDirectory } from './rules/loader';
import { getActiveProfile, buildProfilePromptContext } from './profiles';
import { getEffectiveReviewPrompt, getEffectiveFrameworks } from './config/promptLoader';
import { resolvePrompt } from './utils';
import {
	loadContentstackSchemas,
	getContentstackConfig,
	parseContentstackAccesses,
	validateFieldAccesses,
	buildContentstackPromptSection,
} from './contentstack';

export const DEFAULT_REVIEW_PROMPT = "You are an expert software engineer and code reviewer with deep knowledge of the following frameworks and libraries: **${frameworks}**.\nYour task is to analyze the following code changes (in git diff format) and provide constructive, actionable feedback tailored to the conventions, best practices, and common pitfalls of these technologies.\n${skills}\n${profile}\n**How to Read the Git Diff Format:**\n- Lines starting with `---` and `+++` indicate the file names before and after the changes.\n- Lines starting with `@@` (e.g., `@@ -15,7 +15,9 @@`) denote the location of the changes within the file.\n- Lines starting with a `-` are lines that were DELETED.\n- Lines starting with a `+` are lines that were ADDED.\n- Lines without a prefix (starting with a space) are for context and have not been changed. **Please focus your review on the added (`+`) and deleted (`-`) lines.**\n\n**Review Focus:**\n- Potential bugs or logical errors specific to the frameworks/libraries (${frameworks}).\n- Performance optimizations, considering framework-specific patterns.\n- Code style inconsistencies or deviations from ${frameworks} best practices.\n- Security vulnerabilities, especially those common in ${frameworks}.\n- Improvements to maintainability and readability, aligned with ${frameworks} conventions.\n\n**Feedback Requirements:**\n1. Explain any issues clearly and concisely, referencing ${frameworks} where relevant.\n2. Suggest specific code changes or improvements. Include code snippets for examples where appropriate.\n3. Use Markdown for clear formatting.\n\nIf you find no issues, please respond with the single sentence: \"I have reviewed the changes and found no significant issues.\"\n\nHere is the code diff to review:\n---\n${code}\n---";

export interface BuildReviewPromptOptions {
	context?: vscode.ExtensionContext;
	contextBundle?: ContextBundle;
	diff: string;
	outputChannel?: vscode.OutputChannel;
}

export async function buildReviewPrompt({
	context,
	contextBundle,
	diff,
	outputChannel,
}: BuildReviewPromptOptions): Promise<string> {
	const log = (message: string): void => {
		outputChannel?.appendLine(message);
	};

	const frameworksList = (await getEffectiveFrameworks(outputChannel)).join(', ');
	let skillContext = '';

	if (context) {
		const selectedSkills = context.globalState.get<any[]>('selectedSkills', []);
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

	return prompt;
}
