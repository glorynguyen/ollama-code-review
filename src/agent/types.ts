/**
 * F-007: Agentic Multi-Step Reviews — Types
 *
 * Typed interfaces for the multi-step agent review pipeline.
 * Each step is a discrete unit that takes typed input and produces typed output,
 * allowing the orchestrator to chain them with progress reporting.
 */

import type { ContextBundle } from '../context/types';
import type { ValidatedStructuredReviewResult } from '../reviewFindings';

/** Brand symbol for runtime-safe AICallerFn identification. */
const AI_CALLER_BRAND = Symbol('AICallerFn');

/** Shared type for the AI caller function passed between agent steps. */
export type AICallerFn = ((prompt: string, options?: { responseFormat?: 'structured-review' | 'markdown' }) => Promise<string>) & { [AI_CALLER_BRAND]: true };

/**
 * Brand a plain function as an AICallerFn so that `isAICallerFn` can
 * distinguish it from arbitrary functions stored in the untyped stepResults Map.
 */
export function markAsAICaller(
	fn: (prompt: string, options?: { responseFormat?: 'structured-review' | 'markdown' }) => Promise<string>,
): AICallerFn {
	return Object.assign(fn, { [AI_CALLER_BRAND]: true as const });
}

/**
 * Type guard for AICallerFn — checks the value is a function that has been
 * explicitly branded via `markAsAICaller`. This prevents accidentally treating
 * arbitrary functions from the untyped stepResults Map as AI callers.
 */
export function isAICallerFn(fn: unknown): fn is AICallerFn {
	return typeof fn === 'function' && AI_CALLER_BRAND in fn;
}

/** Type guard for DiffAnalysis — validates required structural fields and types. */
export function isDiffAnalysis(value: unknown): value is DiffAnalysis {
	return value !== null &&
		typeof value === 'object' &&
		'summary' in value &&
		typeof (value as DiffAnalysis).summary === 'string' &&
		'changedFiles' in value &&
		Array.isArray((value as DiffAnalysis).changedFiles);
}

/** Type guard for GatheredContext — validates required structural fields and types. */
export function isGatheredContext(value: unknown): value is GatheredContext {
	return value !== null &&
		typeof value === 'object' &&
		'workspacePatterns' in value &&
		Array.isArray((value as GatheredContext).workspacePatterns);
}

// ---------------------------------------------------------------------------
// Agent Configuration
// ---------------------------------------------------------------------------

/** User-facing settings for the agent review mode. */
export interface AgentModeConfig {
	/** Whether multi-step agentic reviews are enabled. */
	enabled: boolean;
	/** Maximum number of context files to resolve during the gather step. */
	maxContextFiles: number;
	/** Include test files in context. */
	includeTests: boolean;
	/** Include .d.ts type definitions in context. */
	includeTypes: boolean;
	/** Run a self-critique pass during synthesis. */
	selfCritique: boolean;
}

// ---------------------------------------------------------------------------
// Step Contracts
// ---------------------------------------------------------------------------

/** A named step in the agent pipeline with typed input/output. */
export interface AgentStep<TInput, TOutput> {
	/** Unique step identifier. */
	name: string;
	/** Human-readable label for progress UI. */
	label: string;
	/** Execute the step. Receives shared context + typed input; returns typed output. */
	execute(input: TInput, ctx: AgentContext): Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Shared Agent Context
// ---------------------------------------------------------------------------

/**
 * Mutable context object threaded through every step.
 * Steps can read/write to accumulate state across the pipeline.
 */
export interface AgentContext {
	/** The original diff being reviewed. */
	diff: string;
	/** VS Code extension context (for settings, globalState). */
	extensionContext: import('vscode').ExtensionContext;
	/** Output channel for logging. */
	outputChannel: import('vscode').OutputChannel;
	/** Report progress to the notification UI. */
	reportProgress: (message: string) => void;
	/** Cancellation token — steps should check periodically. */
	cancellationToken: import('vscode').CancellationToken;
	/** Accumulated results from prior steps, keyed by step name. */
	stepResults: Map<string, unknown>;
	/** Agent config resolved at start. */
	config: AgentModeConfig;
}

// ---------------------------------------------------------------------------
// Step I/O Types
// ---------------------------------------------------------------------------

/** Step 1 output: structural analysis of the diff. */
export interface DiffAnalysis {
	/** Files changed, with per-file metadata. */
	changedFiles: ChangedFileInfo[];
	/** High-level summary of what the diff does. */
	summary: string;
	/** Detected change categories (e.g. "refactor", "feature", "bugfix"). */
	changeTypes: string[];
}

export interface ChangedFileInfo {
	filePath: string;
	linesAdded: number;
	linesRemoved: number;
	/** Heuristic: 'source' | 'test' | 'config' | 'docs' | 'other'. */
	fileType: string;
}

/** Step 2 output: context gathered from workspace. */
export interface GatheredContext {
	/** The context bundle from the existing F-008 system. */
	contextBundle?: ContextBundle;
	/** Additional workspace patterns discovered (naming conventions etc.). */
	workspacePatterns: string[];
}

/** Step 3 output: pattern analysis results. */
export interface PatternAnalysis {
	/** AI-generated observations about codebase conventions. */
	observations: string;
	/** Specific naming/structural patterns the diff should follow. */
	patterns: string[];
}

/** Step 4 output: deep review results. */
export interface DeepReview {
	/** The full review markdown from the AI. */
	reviewMarkdown: string;
	/** F-031: Structured findings for sidebar integration. */
	structuredReview?: ValidatedStructuredReviewResult;
}

/** Step 5 output: synthesised final review. */
export interface SynthesisResult {
	/** The final, refined review markdown. */
	finalReview: string;
	/** Self-critique notes (if enabled). */
	selfCritiqueNotes?: string;
	/** F-031: Final structured findings for sidebar integration. */
	structuredFindings?: ValidatedStructuredReviewResult;
}

// ---------------------------------------------------------------------------
// Pipeline Result
// ---------------------------------------------------------------------------

/** The complete result from an agentic multi-step review. */
export interface AgentReviewResult {
	/** Final review markdown to display. */
	review: string;
	/** Diff analysis from step 1. */
	diffAnalysis: DiffAnalysis;
	/** Context gathered in step 2. */
	gatheredContext: GatheredContext;
	/** Pattern analysis from step 3. */
	patternAnalysis: PatternAnalysis;
	/** Deep review from step 4. */
	deepReview: DeepReview;
	/** Synthesis from step 5. */
	synthesis: SynthesisResult;
	/** Total pipeline duration in milliseconds. */
	durationMs: number;
	/** Number of steps completed. */
	stepsCompleted: number;
}
