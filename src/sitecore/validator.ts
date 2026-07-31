/**
 * F-050: Sitecore Layout Service Schema Validation — Validator
 *
 * Validates extracted field accesses against loaded component schemas.
 * Uses Levenshtein distance to suggest the closest matching field name
 * when an invalid field is detected.
 */
import type {
	SitecoreSchemaCache,
	SitecoreFieldAccess,
	SitecoreFieldValidationResult,
	SitecoreValidationResult,
	SitecoreCodeParseResult,
} from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates parsed field accesses against the Sitecore schema cache.
 *
 * For each field access:
 * 1. Resolves the component (by name or file inference)
 * 2. Checks if the field name exists on the component or its children
 * 3. Suggests the closest field name if invalid (Levenshtein distance)
 *
 * @param parseResult  Output from parseSitecoreFieldAccesses
 * @param schema       Loaded schema cache
 * @returns Validation results with per-field validity and suggestions
 */
export function validateSitecoreFieldAccesses(
	parseResult: SitecoreCodeParseResult,
	schema: SitecoreSchemaCache,
): SitecoreValidationResult {
	const fields: SitecoreFieldValidationResult[] = [];
	const resolvedSet = new Set<string>();
	const unresolvedSet = new Set<string>();

	for (const access of parseResult.accesses) {
		const result = _validateSingleAccess(access, schema);
		fields.push(result);

		if (result.componentName) {
			resolvedSet.add(result.componentName);
		} else if (access.componentName) {
			unresolvedSet.add(access.componentName);
		}
	}

	// Remove resolved from unresolved
	for (const r of Array.from(resolvedSet)) {
		unresolvedSet.delete(r);
	}

	return {
		fields,
		resolvedComponents: Array.from(resolvedSet),
		unresolvedComponents: Array.from(unresolvedSet),
		stats: {
			totalAccesses: parseResult.accesses.length,
			validFields: fields.filter(f => f.valid).length,
			invalidFields: fields.filter(f => !f.valid).length,
			unresolvedComponents: unresolvedSet.size,
		},
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _validateSingleAccess(
	access: SitecoreFieldAccess,
	schema: SitecoreSchemaCache,
): SitecoreFieldValidationResult {
	// Try to find the component
	const componentName = access.componentName;
	if (!componentName) {
		// Can't validate without a component reference
		return { access, valid: true, componentName: undefined };
	}

	const component = schema.components[componentName];
	if (!component) {
		// Component not in schema — can't validate
		return { access, valid: true, componentName: undefined };
	}

	// Determine which field list to check
	const fieldList = access.isChildAccess
		? (component.childFields || [])
		: component.fields;

	const fieldNames = fieldList.map(f => f.name);

	// Nothing to validate against. This happens legitimately: the Layout Service
	// only reports fields that carry a value on the sampled route, and array-valued
	// fields (Multilist/Treelist) are recorded as childFields rather than fields.
	// A component whose fields are all Multilists therefore has an empty `fields`
	// list. Treat that as unvalidatable rather than flagging every access.
	// Keep componentName so the component still counts as resolved and its schema
	// (including child fields) is rendered in the prompt.
	if (fieldNames.length === 0) {
		return { access, valid: true, componentName };
	}

	// Check if the field exists (case-sensitive)
	if (fieldNames.includes(access.fieldName)) {
		return { access, valid: true, componentName };
	}

	// Check case-insensitive match
	const lowerField = access.fieldName.toLowerCase();
	const caseMatch = fieldNames.find(f => f.toLowerCase() === lowerField);
	if (caseMatch) {
		return {
			access,
			valid: false,
			componentName,
			suggestion: caseMatch,
			distance: 0, // Same field, wrong case
		};
	}

	// Find closest match using Levenshtein distance
	let bestSuggestion: string | undefined;
	let bestDistance = Infinity;

	for (const name of fieldNames) {
		const dist = _levenshtein(access.fieldName.toLowerCase(), name.toLowerCase());
		if (dist < bestDistance && dist <= 3) { // Only suggest within distance 3
			bestDistance = dist;
			bestSuggestion = name;
		}
	}

	return {
		access,
		valid: false,
		componentName,
		suggestion: bestSuggestion,
		distance: bestSuggestion ? bestDistance : undefined,
	};
}

/**
 * Computes Levenshtein distance between two strings.
 */
function _levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;

	if (m === 0) { return n; }
	if (n === 0) { return m; }

	const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

	for (let i = 0; i <= m; i++) { dp[i][0] = i; }
	for (let j = 0; j <= n; j++) { dp[0][j] = j; }

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost,
			);
		}
	}

	return dp[m][n];
}
