/**
 * F-007: Agentic Multi-Step Reviews — Step 5: Synthesis
 *
 * Combines the deep review with pattern analysis to produce a final, refined
 * review. Optionally runs a self-critique pass where the model evaluates
 * its own findings and removes false positives.
 */

import type { AgentStep, AgentContext, DeepReview, SynthesisResult, DiffAnalysis } from '../types';

export const synthesisStep: AgentStep<DeepReview, SynthesisResult> = {
	name: 'synthesis',
	label: 'Synthesizing final review…',

	async execute(deepReview: DeepReview, ctx: AgentContext): Promise<SynthesisResult> {
		ctx.reportProgress('Step 5/5 — Synthesizing final review…');
		ctx.outputChannel.appendLine('[Agent] Step 5: Synthesis');

		const callAI = ctx.stepResults.get('callAI') as
			((prompt: string) => Promise<string>) | undefined;

		// If no self-critique or no AI caller, return the deep review as-is
		if (!ctx.config.selfCritique || !callAI) {
			ctx.outputChannel.appendLine('[Agent] Step 5: Returning deep review without self-critique');
			return { finalReview: deepReview.reviewMarkdown };
		}

		// Retrieve diff analysis for additional context
		const diffAnalysis = ctx.stepResults.get('analyzeDiff') as DiffAnalysis | undefined;

		const prompt = `You are an expert code reviewer performing a self-critique of your own review.

Below is a code review that was generated for a diff. Your task is to:

1. **Remove false positives** — Delete any findings that are incorrect or not actually present in the code.
2. **Prioritize** — Reorder findings so the most important ones come first.
3. **Consolidate** — Merge duplicate or overlapping findings.
4. **Add summary** — Add a brief "Summary" section at the top with 2-3 sentences about the overall quality.
5. **Preserve formatting** — Keep the severity badges (🔴/🟠/🟡/🟢) and Markdown formatting.

${diffAnalysis ? `Diff summary: ${diffAnalysis.summary}` : ''}

**Original Review:**
${deepReview.reviewMarkdown}

**Original Diff (for verification):**
\`\`\`diff
${ctx.diff.substring(0, 6000)}
\`\`\`

Output the refined review in full. Do not add meta-commentary about what you changed — just output the improved review.`;

		try {
			const refinedReview = await callAI(prompt);
			ctx.outputChannel.appendLine(`[Agent] Step 5: Self-critique completed (${refinedReview.length} chars)`);

			return {
				finalReview: refinedReview,
				selfCritiqueNotes: `Self-critique refined ${deepReview.reviewMarkdown.length} → ${refinedReview.length} chars`,
			};
		} catch (err) {
			ctx.outputChannel.appendLine(`[Agent] Step 5: Self-critique failed (non-fatal): ${err}`);
			return { finalReview: deepReview.reviewMarkdown };
		}
	},
};
