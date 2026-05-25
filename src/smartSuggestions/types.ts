/**
 * F-049: Smart Review Suggestions — Types
 *
 * Defines the interfaces for post-review contextual suggestions that
 * connect findings, profiles, and workflow actions into intelligent
 * next-step recommendations.
 */

import type { FindingCounts } from '../notifications';
import type { Severity } from '../github/commentMapper';
import type { ReviewScore } from '../reviewScore';

/** Priority of a suggestion — determines display order and visual weight. */
export type SuggestionPriority = 'high' | 'medium' | 'low';

/** Category of the suggested action. */
export type SuggestionCategory =
	| 'fix'          // Auto-fixable findings
	| 'profile'      // Profile switch recommendation
	| 'security'     // Security-specific follow-up
	| 'performance'  // Performance-specific follow-up
	| 'trend'        // Trend/pattern from review history
	| 'workflow';    // General workflow action

/** A single smart suggestion shown after a review. */
export interface SmartSuggestion {
	id: string;
	category: SuggestionCategory;
	priority: SuggestionPriority;
	title: string;
	description: string;
	/** VS Code command to execute when the user clicks the suggestion. */
	command?: string;
	/** Arguments for the command. */
	commandArgs?: unknown[];
	/** Icon identifier (ThemeIcon name). */
	icon?: string;
}

/** Input context used to generate suggestions. */
export interface SuggestionInput {
	/** Finding counts from the current review. */
	findingCounts: FindingCounts;
	/** Active review profile name. */
	activeProfile: string;
	/** Files changed in the diff. */
	filesReviewed: string[];
	/** The raw diff text. */
	diff: string;
	/** Review quality score (0-100). */
	score: number;
	/** Issue categories detected. */
	categories?: Partial<Record<string, number>>;
	/** Historical review scores (most recent first). */
	recentScores?: ReviewScore[];
	/** Number of findings with file+line references (fixable). */
	fixableCount?: number;
	/** Total number of findings. */
	totalFindings?: number;
}

/** Result of suggestion generation. */
export interface SuggestionResult {
	suggestions: SmartSuggestion[];
	generatedAt: string;
}
