/**
 * F-037: Auto-detect & Suggest the Best Model for the Task
 * Type definitions for the model recommendation engine.
 */

/** Task the user is about to perform */
export type TaskType =
	| 'review'
	| 'commit-message'
	| 'explain'
	| 'generate-tests'
	| 'fix'
	| 'document'
	| 'diagram'
	| 'agent-review'
	| 'version-bump'
	| 'file-review';

/** Diff size bucket for affinity scoring */
export type DiffSizeBucket = 'small' | 'medium' | 'large';

/** Capability tier for a known model */
export type ModelTier = 'flagship' | 'balanced' | 'fast' | 'code-specialist' | 'local';

/** Input to the recommendation engine */
export interface ModelAdvisorInput {
	/** Which command is about to run */
	taskType: TaskType;
	/** Primary file extensions in the diff/selection (e.g., ['ts', 'tsx']) */
	languages: string[];
	/** Character count of the diff/code being sent */
	contentLength: number;
	/** Active review profile name, if any (e.g., 'security', 'general') */
	activeProfile?: string;
}

/** Single model recommendation */
export interface ModelSuggestion {
	/** Model identifier as stored in settings (e.g., 'claude-opus-4-20250514') */
	modelId: string;
	/** Provider name from ProviderRegistry */
	providerName: string;
	/** Human-readable reason for the suggestion (shown in QuickPick) */
	reason: string;
	/** Composite score 0–1 */
	score: number;
	/** Capability tier */
	tier: ModelTier;
}

/** Output from the recommendation engine */
export interface ModelAdvisorResult {
	/** Top recommendation */
	recommended: ModelSuggestion;
	/** All scored candidates, descending by score (max 5) */
	alternatives: ModelSuggestion[];
	/** Whether auto-select is enabled in settings */
	autoSelect: boolean;
}

/** Static metadata about a known model */
export interface ModelProfile {
	modelId: string;
	providerName: string;
	tier: ModelTier;
	/** Language affinities: extension → bonus score (0–0.3) */
	languageBonus?: Record<string, number>;
}
