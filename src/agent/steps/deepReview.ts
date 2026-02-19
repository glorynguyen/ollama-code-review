/**
 * F-007: Agentic Multi-Step Reviews — Step 4: Deep Review
 *
 * The main AI review pass. Sends a comprehensive prompt that includes the diff,
 * gathered context, pattern analysis results, and the user's active profile.
 * This produces the bulk of the review findings.
 */

import type { AgentStep, AgentContext, PatternAnalysis, DeepReview, DiffAnalysis } from '../types';
import type { GatheredContext } from '../types';
import { formatContextForPrompt } from '../../context';

export const deepReviewStep: AgentStep<PatternAnalysis, DeepReview> = {
	name: 'deepReview',
	label: 'Running deep review…',

	async execute(patternAnalysis: PatternAnalysis, ctx: AgentContext): Promise<DeepReview> {
		ctx.reportProgress('Step 4/5 — Running deep AI review…');
		ctx.outputChannel.appendLine('[Agent] Step 4: Deep review');

		const callAI = ctx.stepResults.get('callAI') as
			((prompt: string) => Promise<string>) | undefined;

		if (!callAI) {
			throw new Error('AI caller not available — cannot perform deep review');
		}

		// Retrieve prior step results
		const diffAnalysis = ctx.stepResults.get('analyzeDiff') as DiffAnalysis | undefined;
		const gathered = ctx.stepResults.get('gatherContext') as GatheredContext | undefined;

		// Build context section
		let contextSection = '';
		if (gathered?.contextBundle && gathered.contextBundle.files.length > 0) {
			contextSection = '\n' + formatContextForPrompt(gathered.contextBundle);
		}

		// Build patterns section
		let patternsSection = '';
		if (patternAnalysis.patterns.length > 0) {
			patternsSection = `\n\n**Codebase Conventions Detected:**\n${patternAnalysis.patterns.map(p => `- ${p}`).join('\n')}\n\nEnsure your review checks whether the diff follows these conventions.\n`;
		}

		// Build diff summary
		let diffSummary = '';
		if (diffAnalysis) {
			diffSummary = `\n**Diff Summary:** ${diffAnalysis.summary}\n`;
			if (diffAnalysis.changeTypes.length > 0) {
				diffSummary += `**Change Type(s):** ${diffAnalysis.changeTypes.join(', ')}\n`;
			}
		}

		// Get the profile and skills prompt (stored by orchestrator)
		const profileContext = (ctx.stepResults.get('profileContext') as string) ?? '';
		const skillContext = (ctx.stepResults.get('skillContext') as string) ?? '';

		const prompt = `You are an expert software engineer performing a thorough, multi-step code review.

This is the DEEP REVIEW step. Previous analysis has already identified the diff structure and codebase patterns. Now perform a comprehensive review.
${diffSummary}${patternsSection}${skillContext}${profileContext}

**Review Focus:**
1. **Security** — Injection, XSS, SSRF, authentication/authorization flaws, secrets in code
2. **Bugs** — Logic errors, null/undefined risks, race conditions, off-by-one errors
3. **Performance** — Unnecessary allocations, N+1 queries, missing memoization, large bundle impact
4. **Maintainability** — Code clarity, DRY violations, proper error handling, test coverage gaps

**Output Requirements:**
- For each finding, include a severity badge: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low
- Reference the specific file and line where applicable
- Provide a concrete suggestion or code snippet for each finding
- Use Markdown formatting
- If you find no issues, respond with: "I have reviewed the changes and found no significant issues."
${contextSection}

**Code diff to review:**
\`\`\`diff
${ctx.diff}
\`\`\``;

		const reviewMarkdown = await callAI(prompt);
		ctx.outputChannel.appendLine(`[Agent] Step 4: Deep review completed (${reviewMarkdown.length} chars)`);

		return { reviewMarkdown };
	},
};
