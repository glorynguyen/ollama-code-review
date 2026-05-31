/**
 * F-050: Code Health Regression Guard
 *
 * Types for per-file health tracking, regression detection, and hotspot surfacing.
 */

import type { FindingCounts } from '../notifications';

/** Configuration for the Code Health feature. */
export interface CodeHealthConfig {
	enabled: boolean;
	/** Score drop (points) that triggers a regression warning. */
	regressionThreshold: number;
	/** Block commits if a file regresses below this floor (0 = disabled). */
	blockOnRegression: boolean;
	/** Number of worst-scoring files to surface in the hotspot view. */
	hotspotCount: number;
}

/** A single file's health snapshot at a point in time. */
export interface FileHealthEntry {
	filePath: string;
	score: number;
	findingCounts: FindingCounts;
	timestamp: string;
	reviewId: string;
}

/** Aggregated health state for a single file. */
export interface FileHealthSummary {
	filePath: string;
	/** Current score (from most recent review). */
	currentScore: number;
	/** Average score across all reviews. */
	averageScore: number;
	/** Score from the previous review (undefined if only reviewed once). */
	previousScore: number | undefined;
	/** Score delta from previous review (negative = regression). */
	delta: number | undefined;
	/** Number of times this file has been reviewed. */
	reviewCount: number;
	/** Timestamp of the most recent review. */
	lastReviewedAt: string;
	/** Accumulated finding counts from the latest review. */
	findingCounts: FindingCounts;
}

/** Result of a regression check after a review completes. */
export interface RegressionResult {
	/** Files that regressed beyond the threshold. */
	regressions: FileRegression[];
	/** Whether at least one regression was detected. */
	hasRegressions: boolean;
}

/** A detected regression for a specific file. */
export interface FileRegression {
	filePath: string;
	previousScore: number;
	currentScore: number;
	delta: number;
}
