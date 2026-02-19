/**
 * F-007: Agentic Multi-Step Reviews — Step 3: Pattern Analysis
 *
 * Sends a focused AI prompt asking the model to identify codebase conventions
 * and compare the diff against them. This is a lighter, faster call than the
 * full deep review — it primes the synthesis step with convention awareness.
 */

import type { AgentStep, AgentContext, GatheredContext, PatternAnalysis } from '../types';
import { formatContextForPrompt } from '../../context';

export const patternAnalysisStep: AgentStep<GatheredContext, PatternAnalysis> = {
	name: 'patternAnalysis',
	label: 'Checking codebase patterns…',

	async execute(gathered: GatheredContext, ctx: AgentContext): Promise<PatternAnalysis> {
		ctx.reportProgress('Step 3/5 — Analyzing codebase patterns…');
		ctx.outputChannel.appendLine('[Agent] Step 3: Pattern analysis');

		// Get the AI caller from the step results (set by the orchestrator)
		const callAI = ctx.stepResults.get('callAI') as
			((prompt: string) => Promise<string>) | undefined;

		if (!callAI) {
			ctx.outputChannel.appendLine('[Agent] Step 3: No AI caller available, skipping pattern analysis');
			return { observations: '', patterns: gathered.workspacePatterns };
		}

		// Build a concise prompt for pattern detection
		let contextSection = '';
		if (gathered.contextBundle && gathered.contextBundle.files.length > 0) {
			contextSection = formatContextForPrompt(gathered.contextBundle);
		}

		const patternsInfo = gathered.workspacePatterns.length > 0
			? `\nDetected workspace patterns:\n${gathered.workspacePatterns.map(p => `- ${p}`).join('\n')}`
			: '';

		const prompt = `You are an expert code reviewer. Analyze the following code diff and related context files to identify coding conventions and patterns used in this codebase.

Focus on:
1. Naming conventions (variables, functions, files)
2. Code organization patterns
3. Error handling approaches
4. Import/export style
5. Testing patterns (if test files are present)

Be concise — output a short list of observed patterns (max 10 bullet points). Do NOT review the code for bugs yet.
${patternsInfo}
${contextSection}

Diff to analyze:
\`\`\`
${ctx.diff.substring(0, 8000)}
\`\`\`

Output only the bullet-point list of patterns, nothing else.`;

		try {
			const response = await callAI(prompt);

			// Parse bullet points from response
			const patterns = response
				.split('\n')
				.map(line => line.replace(/^[-*•]\s*/, '').trim())
				.filter(line => line.length > 0 && line.length < 200);

			ctx.outputChannel.appendLine(`[Agent] Step 3: Found ${patterns.length} patterns`);

			return {
				observations: response,
				patterns: [...gathered.workspacePatterns, ...patterns],
			};
		} catch (err) {
			ctx.outputChannel.appendLine(`[Agent] Step 3: AI call failed (non-fatal): ${err}`);
			return {
				observations: '',
				patterns: gathered.workspacePatterns,
			};
		}
	},
};
