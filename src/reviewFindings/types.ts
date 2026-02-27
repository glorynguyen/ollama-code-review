/**
 * F-031: Review Findings Explorer — Types
 */

import type { ReviewFinding, Severity } from '../github/commentMapper';

/** A finding enriched with a unique ID for tree-view tracking. */
export interface IndexedFinding extends ReviewFinding {
	/** Auto-assigned sequential index. */
	index: number;
}

/** Summary counts by severity for the tree view description. */
export type SeverityCounts = Record<Severity, number>;
