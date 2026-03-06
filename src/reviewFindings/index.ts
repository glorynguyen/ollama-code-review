/**
 * F-031: Review Findings Explorer — Barrel Exports
 */
export { FindingsTreeProvider } from './findingsTreeProvider';
export {
	STRUCTURED_REVIEW_SCHEMA_VERSION,
} from './types';
export {
	buildDiffAnchorIndex,
	normalizeReviewResult,
	renderValidatedReviewMarkdown,
	toLegacyReviewFinding,
	validateReviewAnchor,
} from './structuredReview';
export type {
	AnchorValidationResult,
	AnchorValidationStatus,
	DiffAnchorIndex,
	DiffFileAnchors,
	IndexedFinding,
	ReviewAnchor,
	ReviewEvidenceItem,
	ReviewEvidenceKind,
	ReviewFixSuggestion,
	SeverityCounts,
	StructuredReviewFinding,
	StructuredReviewResult,
	StructuredReviewSchemaVersion,
	ValidatedStructuredReviewFinding,
	ValidatedStructuredReviewResult,
} from './types';
