/**
 * F-032: Contentstack Schema Validation — Validator
 *
 * Validates extracted field accesses against loaded Content Type schemas.
 * Uses Levenshtein distance to suggest the closest matching field name
 * when an invalid field is detected.
 */
import type {
	ContentTypeSchema,
	ExtractedFieldAccess,
	FieldValidationResult,
	ValidationResult,
	CodeParseResult,
} from './types';
import { collectFieldUids } from './schemaFetcher';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates parsed field accesses against the available Content Type schemas.
 *
 * For each field access:
 * 1. Resolves the content type (by UID or best-guess matching)
 * 2. Checks if the field UID exists in the schema
 * 3. Suggests the closest field name if invalid (Levenshtein distance)
 *
 * @param parseResult   Output from {@link parseContentstackAccesses}
 * @param schemas       Loaded Content Type schemas
 * @returns Validation results with per-field validity and suggestions
 */
export function validateFieldAccesses(
	parseResult: CodeParseResult,
	schemas: ContentTypeSchema[],
): ValidationResult {
	const schemaLookup = new Map<string, ContentTypeSchema>();
	for (const s of schemas) {
		schemaLookup.set(s.uid, s);
	}

	// Pre-compute field UID sets for each content type
	const fieldSets = new Map<string, Set<string>>();
	for (const s of schemas) {
		fieldSets.set(s.uid, collectFieldUids(s));
	}

	const fields: FieldValidationResult[] = [];
	const resolvedSet = new Set<string>();
	const unresolvedSet = new Set<string>();

	for (const access of parseResult.accesses) {
		const result = _validateSingleAccess(access, schemaLookup, fieldSets);
		fields.push(result);

		if (result.contentTypeUid) {
			if (schemaLookup.has(result.contentTypeUid)) {
				resolvedSet.add(result.contentTypeUid);
			} else {
				unresolvedSet.add(result.contentTypeUid);
			}
		}
	}

	// Also track content type UIDs from the parse result that weren't in schemas
	for (const uid of parseResult.contentTypeUids) {
		if (schemaLookup.has(uid)) {
			resolvedSet.add(uid);
		} else {
			unresolvedSet.add(uid);
		}
	}

	const validCount = fields.filter((f) => f.valid).length;
	const invalidCount = fields.filter((f) => !f.valid).length;

	return {
		fields,
		resolvedContentTypes: [...resolvedSet].map((uid) => schemaLookup.get(uid)!).filter(Boolean),
		unresolvedContentTypes: [...unresolvedSet],
		stats: {
			totalAccesses: fields.length,
			validFields: validCount,
			invalidFields: invalidCount,
			unresolvedTypes: unresolvedSet.size,
		},
	};
}

// ---------------------------------------------------------------------------
// Single field validation
// ---------------------------------------------------------------------------

function _validateSingleAccess(
	access: ExtractedFieldAccess,
	schemaLookup: Map<string, ContentTypeSchema>,
	fieldSets: Map<string, Set<string>>,
): FieldValidationResult {
	const ctUid = access.contentTypeUid;

	// If we know the content type, validate against its fields
	if (ctUid && fieldSets.has(ctUid)) {
		const fields = fieldSets.get(ctUid)!;
		if (fields.has(access.fieldName)) {
			return { access, valid: true, contentTypeUid: ctUid };
		}

		// Find closest match
		const { suggestion, distance } = _findClosestField(access.fieldName, fields);
		return {
			access,
			valid: false,
			suggestion,
			distance,
			contentTypeUid: ctUid,
		};
	}

	// Content type unknown — check against all schemas
	if (!ctUid) {
		// If the field exists in ANY schema, consider it valid
		for (const [uid, fields] of fieldSets) {
			if (fields.has(access.fieldName)) {
				return { access, valid: true, contentTypeUid: uid };
			}
		}

		// Find closest match across all schemas
		let bestSuggestion: string | undefined;
		let bestDistance = Infinity;
		let bestCtUid: string | undefined;

		for (const [uid, fields] of fieldSets) {
			const { suggestion, distance } = _findClosestField(access.fieldName, fields);
			if (suggestion && distance < bestDistance) {
				bestSuggestion = suggestion;
				bestDistance = distance;
				bestCtUid = uid;
			}
		}

		return {
			access,
			valid: false,
			suggestion: bestSuggestion,
			distance: bestDistance < Infinity ? bestDistance : undefined,
			contentTypeUid: bestCtUid,
		};
	}

	// Content type specified but not found in schemas
	return {
		access,
		valid: false,
		contentTypeUid: ctUid,
	};
}

// ---------------------------------------------------------------------------
// Levenshtein distance & closest match
// ---------------------------------------------------------------------------

/**
 * Finds the closest matching field name from a set using Levenshtein distance.
 * Only returns a suggestion if the distance is within a reasonable threshold
 * (max 3 edits or 40% of the field name length, whichever is greater).
 */
function _findClosestField(
	fieldName: string,
	validFields: Set<string>,
): { suggestion?: string; distance: number } {
	let best: string | undefined;
	let bestDist = Infinity;

	const threshold = Math.max(3, Math.ceil(fieldName.length * 0.4));

	for (const candidate of validFields) {
		const dist = _levenshtein(fieldName.toLowerCase(), candidate.toLowerCase());
		if (dist < bestDist) {
			bestDist = dist;
			best = candidate;
		}
	}

	if (best && bestDist <= threshold) {
		return { suggestion: best, distance: bestDist };
	}

	return { distance: Infinity };
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * Uses the classic dynamic programming approach.
 */
function _levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;

	if (m === 0) { return n; }
	if (n === 0) { return m; }

	// Use a single array for space efficiency
	const prev = new Array<number>(n + 1);
	for (let j = 0; j <= n; j++) { prev[j] = j; }

	for (let i = 1; i <= m; i++) {
		let prevDiag = prev[0];
		prev[0] = i;
		for (let j = 1; j <= n; j++) {
			const temp = prev[j];
			if (a[i - 1] === b[j - 1]) {
				prev[j] = prevDiag;
			} else {
				prev[j] = 1 + Math.min(prevDiag, prev[j], prev[j - 1]);
			}
			prevDiag = temp;
		}
	}

	return prev[n];
}
