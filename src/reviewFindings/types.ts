/**
 * Review Findings — Shared Types
 */

import type { ReviewFinding, Severity } from '../github/commentMapper';

/** A finding enriched with a unique ID for tree-view tracking. */
export interface IndexedFinding extends ReviewFinding {
	/** Auto-assigned sequential index. */
	index: number;
}

/** Summary counts by severity for the tree view description. */
export type SeverityCounts = Record<Severity, number>;

/**
 * Stable schema identifier for model-generated structured review payloads.
 * Bump this when the JSON contract changes in a breaking way.
 */
export const STRUCTURED_REVIEW_SCHEMA_VERSION = '1.0.0' as const;

export type StructuredReviewSchemaVersion = typeof STRUCTURED_REVIEW_SCHEMA_VERSION;

/** Where a piece of evidence came from. */
export type ReviewEvidenceKind = 'diff' | 'code' | 'rule' | 'context' | 'test';

/** Result of validating a model-supplied file/line anchor against the actual diff. */
export type AnchorValidationStatus =
	| 'valid'
	| 'missing'
	| 'unknown-file'
	| 'invalid-line'
	| 'not-added-line'
	| 'deleted-file';

/**
 * A concrete anchor in the reviewed codebase.
 * `endLine` is optional so callers can represent either a single line or a range.
 */
export interface ReviewAnchor {
	file: string;
	line: number;
	endLine?: number;
}

/**
 * Supporting evidence for a finding.
 * The initial provider contract should require at least one evidence item.
 */
export interface ReviewEvidenceItem {
	kind: ReviewEvidenceKind;
	summary: string;
	anchor?: ReviewAnchor;
	quote?: string;
}

/**
 * Optional remediation details attached to a finding.
 * This lets us distinguish "there is a suggested fix" from "the model only found an issue".
 */
export interface ReviewFixSuggestion {
	summary: string;
	replacement?: string;
	patch?: string;
}

/**
 * Typed finding emitted by the AI provider.
 * `anchor` is optional so high-level findings can still be represented, but inline PR comments
 * should only be attempted after `anchorValidation.status === 'valid'`.
 */
export interface StructuredReviewFinding {
	id: string;
	severity: Severity;
	title: string;
	summary: string;
	confidence: number;
	category?: string;
	anchor?: ReviewAnchor;
	evidence: ReviewEvidenceItem[];
	fix?: ReviewFixSuggestion;
}

/** Top-level typed payload returned by the structured review pipeline. */
export interface StructuredReviewResult {
	schemaVersion: StructuredReviewSchemaVersion;
	summary: string;
	findings: StructuredReviewFinding[];
}

/**
 * Diff-derived anchor metadata used to validate model output before it reaches GitHub comments,
 * editor decorations, or quick-fix flows.
 */
export interface DiffAnchorIndex {
	files: Map<string, DiffFileAnchors>;
	deletedFiles: Set<string>;
}

export interface DiffFileAnchors {
	file: string;
	addedLines: Set<number>;
}

/** Validation output for each finding anchor. */
export interface AnchorValidationResult {
	status: AnchorValidationStatus;
	normalizedAnchor?: ReviewAnchor;
	reason?: string;
}

/**
 * Enriched finding used by downstream UI/integration layers after the model output has been
 * normalized and validated against the actual diff.
 */
export interface ValidatedStructuredReviewFinding extends StructuredReviewFinding {
	anchorValidation: AnchorValidationResult;
}

/** Final normalized review object consumed by panels, trees, and PR integrations. */
export interface ValidatedStructuredReviewResult extends Omit<StructuredReviewResult, 'findings'> {
	findings: ValidatedStructuredReviewFinding[];
}
