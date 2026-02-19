/**
 * F-007: Agentic Multi-Step Reviews — Orchestrator
 *
 * Runs the 5-step agent pipeline in sequence, threading shared context
 * and reporting progress at each step. Handles cancellation and graceful
 * fallback if individual steps fail.
 *
 * Pipeline:
 *   1. Analyze Diff (local)   → DiffAnalysis
 *   2. Gather Context (local) → GatheredContext
 *   3. Pattern Analysis (AI)  → PatternAnalysis
 *   4. Deep Review (AI)       → DeepReview
 *   5. Synthesis (AI)         → SynthesisResult
 */

import * as vscode from 'vscode';
import type {
	AgentContext,
	AgentModeConfig,
	AgentReviewResult,
	DiffAnalysis,
	GatheredContext,
	PatternAnalysis,
	DeepReview,
	SynthesisResult,
} from './types';
import { analyzeDiffStep } from './steps/analyzeDiff';
import { gatherContextStep } from './steps/gatherContext';
import { patternAnalysisStep } from './steps/patternAnalysis';
import { deepReviewStep } from './steps/deepReview';
import { synthesisStep } from './steps/synthesis';

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_CONFIG: AgentModeConfig = {
	enabled: false,
	maxContextFiles: 10,
	includeTests: true,
	includeTypes: true,
	selfCritique: true,
};

/** Read agent mode config from VS Code settings. */
export function getAgentModeConfig(): AgentModeConfig {
	const cfg = vscode.workspace.getConfiguration('ollama-code-review');
	const raw = cfg.get<Partial<AgentModeConfig>>('agentMode', {});
	return {
		enabled: raw.enabled ?? DEFAULT_AGENT_CONFIG.enabled,
		maxContextFiles: raw.maxContextFiles ?? DEFAULT_AGENT_CONFIG.maxContextFiles,
		includeTests: raw.includeTests ?? DEFAULT_AGENT_CONFIG.includeTests,
		includeTypes: raw.includeTypes ?? DEFAULT_AGENT_CONFIG.includeTypes,
		selfCritique: raw.selfCritique ?? DEFAULT_AGENT_CONFIG.selfCritique,
	};
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full agentic multi-step review pipeline.
 *
 * @param diff - The unified diff to review.
 * @param extensionContext - VS Code extension context.
 * @param outputChannel - Output channel for logging.
 * @param callAI - Function that sends a prompt to the current AI provider and returns the response.
 * @param reportProgress - Callback to report progress to the notification UI.
 * @param cancellationToken - Token to check for user cancellation.
 * @param profileContext - Pre-built profile prompt context string.
 * @param skillContext - Pre-built skill context string.
 * @returns The complete agent review result.
 */
export async function runAgentReview(
	diff: string,
	extensionContext: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
	callAI: (prompt: string) => Promise<string>,
	reportProgress: (message: string) => void,
	cancellationToken: vscode.CancellationToken,
	profileContext: string = '',
	skillContext: string = '',
): Promise<AgentReviewResult> {
	const startTime = Date.now();
	const config = getAgentModeConfig();

	outputChannel.appendLine('\n--- Agent Review Pipeline ---');
	outputChannel.appendLine(`Config: maxContextFiles=${config.maxContextFiles}, selfCritique=${config.selfCritique}`);

	// Build shared context
	const ctx: AgentContext = {
		diff,
		extensionContext,
		outputChannel,
		reportProgress,
		cancellationToken,
		stepResults: new Map(),
		config,
	};

	// Inject the AI caller and prompt context into step results
	ctx.stepResults.set('callAI', callAI);
	ctx.stepResults.set('profileContext', profileContext);
	ctx.stepResults.set('skillContext', skillContext);

	let stepsCompleted = 0;

	// Step 1: Analyze Diff (local, fast)
	let diffAnalysis: DiffAnalysis;
	try {
		checkCancellation(ctx);
		diffAnalysis = await analyzeDiffStep.execute(diff, ctx);
		ctx.stepResults.set('analyzeDiff', diffAnalysis);
		stepsCompleted++;
	} catch (err) {
		if (isCancellation(err)) { throw err; }
		outputChannel.appendLine(`[Agent] Step 1 failed: ${err}`);
		diffAnalysis = { changedFiles: [], summary: 'Analysis failed', changeTypes: [] };
		ctx.stepResults.set('analyzeDiff', diffAnalysis);
	}

	// Step 2: Gather Context (local + file reads)
	let gatheredContext: GatheredContext;
	try {
		checkCancellation(ctx);
		gatheredContext = await gatherContextStep.execute(diffAnalysis, ctx);
		ctx.stepResults.set('gatherContext', gatheredContext);
		stepsCompleted++;
	} catch (err) {
		if (isCancellation(err)) { throw err; }
		outputChannel.appendLine(`[Agent] Step 2 failed: ${err}`);
		gatheredContext = { workspacePatterns: [] };
		ctx.stepResults.set('gatherContext', gatheredContext);
	}

	// Step 3: Pattern Analysis (AI call)
	let patternAnalysis: PatternAnalysis;
	try {
		checkCancellation(ctx);
		patternAnalysis = await patternAnalysisStep.execute(gatheredContext, ctx);
		ctx.stepResults.set('patternAnalysis', patternAnalysis);
		stepsCompleted++;
	} catch (err) {
		if (isCancellation(err)) { throw err; }
		outputChannel.appendLine(`[Agent] Step 3 failed: ${err}`);
		patternAnalysis = { observations: '', patterns: gatheredContext.workspacePatterns };
		ctx.stepResults.set('patternAnalysis', patternAnalysis);
	}

	// Step 4: Deep Review (AI call — the main review)
	let deepReview: DeepReview;
	try {
		checkCancellation(ctx);
		deepReview = await deepReviewStep.execute(patternAnalysis, ctx);
		ctx.stepResults.set('deepReview', deepReview);
		stepsCompleted++;
	} catch (err) {
		if (isCancellation(err)) { throw err; }
		// Step 4 failure is critical — re-throw
		throw new Error(`Deep review failed: ${err}`);
	}

	// Step 5: Synthesis (AI call — self-critique)
	let synthesis: SynthesisResult;
	try {
		checkCancellation(ctx);
		synthesis = await synthesisStep.execute(deepReview, ctx);
		ctx.stepResults.set('synthesis', synthesis);
		stepsCompleted++;
	} catch (err) {
		if (isCancellation(err)) { throw err; }
		outputChannel.appendLine(`[Agent] Step 5 failed: ${err}`);
		synthesis = { finalReview: deepReview.reviewMarkdown };
	}

	const durationMs = Date.now() - startTime;
	outputChannel.appendLine(`[Agent] Pipeline completed in ${durationMs}ms (${stepsCompleted}/5 steps)`);

	return {
		review: synthesis.finalReview,
		diffAnalysis,
		gatheredContext,
		patternAnalysis,
		deepReview,
		synthesis,
		durationMs,
		stepsCompleted,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkCancellation(ctx: AgentContext): void {
	if (ctx.cancellationToken.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
}

function isCancellation(err: unknown): boolean {
	return err instanceof vscode.CancellationError;
}
