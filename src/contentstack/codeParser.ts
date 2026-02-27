/**
 * F-032: Contentstack Schema Validation — Code Parser
 *
 * Parses TypeScript/JavaScript source files to extract Contentstack field
 * accesses. Detects common Contentstack SDK patterns including:
 *
 * - Contentstack SDK calls: `Stack.ContentType('page').Entry(...)` etc.
 * - Property access on entry objects: `entry.hero_title`, `entry['hero_title']`
 * - Destructuring: `const { hero_title, body } = entry`
 * - Next.js / data-fetching patterns: `getEntry()`, `getEntryByUrl()`, etc.
 * - @contentstack/delivery-sdk and contentstack npm package patterns
 */
import type { ExtractedFieldAccess, CodeParseResult } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses source code (or a diff) for Contentstack-related field accesses.
 *
 * @param content   Source code or diff text to parse
 * @param filePath  File path for context (used in results)
 * @returns Parsed field accesses and inferred content type UIDs
 */
export function parseContentstackAccesses(content: string, filePath: string): CodeParseResult {
	const lines = content.split('\n');
	const accesses: ExtractedFieldAccess[] = [];
	const contentTypeUids = new Set<string>();

	// Phase 1: Find content type references
	const ctMap = _extractContentTypeReferences(lines);
	for (const uid of ctMap.values()) {
		contentTypeUids.add(uid);
	}

	// Phase 2: Find entry variable names (variables that hold Contentstack entries)
	const entryVars = _findEntryVariables(lines, ctMap);

	// Phase 3: Extract field accesses from entry variables
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i + 1;

		// Skip comment lines and diff metadata
		if (_isSkippableLine(line)) { continue; }

		// Dot access: entry.fieldName
		for (const [varName, ctUid] of entryVars) {
			_extractDotAccesses(line, lineNum, varName, ctUid, accesses);
			_extractBracketAccesses(line, lineNum, varName, ctUid, accesses);
		}

		// Destructuring: const { field1, field2 } = entry
		_extractDestructuring(line, lineNum, entryVars, accesses);

		// Optional chaining: entry?.fieldName
		for (const [varName, ctUid] of entryVars) {
			_extractOptionalChaining(line, lineNum, varName, ctUid, accesses);
		}
	}

	// Deduplicate
	const seen = new Set<string>();
	const deduped = accesses.filter((a) => {
		const key = `${a.fieldName}:${a.line}`;
		if (seen.has(key)) { return false; }
		seen.add(key);
		return true;
	});

	return {
		accesses: deduped,
		contentTypeUids: [...contentTypeUids],
		filePath,
	};
}

// ---------------------------------------------------------------------------
// Phase 1: Extract content type references
// ---------------------------------------------------------------------------

/**
 * Scans lines for Contentstack SDK calls that reference a content type UID.
 * Returns a map of variable names → content type UIDs.
 *
 * Patterns detected:
 * - `Stack.ContentType('page')`
 * - `contentType('page')`
 * - `getContentType('page')`
 * - `Stack.contentType('page').entry()`
 * - `getEntry({ content_type_uid: 'page', ... })`
 * - `getEntryByUrl({ contentTypeUid: 'page', ... })`
 * - TypeScript type annotations: `: Entry<'page'>`, `: IPage`
 */
function _extractContentTypeReferences(lines: string[]): Map<string, string> {
	const result = new Map<string, string>();

	for (const line of lines) {
		// SDK: Stack.ContentType('uid') / contentType('uid')
		const sdkMatch = line.match(
			/(?:\.|\b)(?:ContentType|contentType|content_type)\s*\(\s*['"`](\w[\w-]*)['"`]\s*\)/
		);
		if (sdkMatch) {
			result.set('__sdk__', sdkMatch[1]);
		}

		// Helper functions: getEntry({ content_type_uid: 'uid' })
		const helperMatch = line.match(
			/(?:getEntr(?:y|ies)|fetchEntr(?:y|ies)|getEntryByUrl)\s*\(\s*\{[^}]*(?:content_type_uid|contentTypeUid|content_type)\s*:\s*['"`](\w[\w-]*)['"`]/
		);
		if (helperMatch) {
			result.set('__helper__', helperMatch[1]);
		}

		// Variable assignment capturing content type: const entries = await getEntries('page')
		const funcCallMatch = line.match(
			/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:\w+\.)*(?:getEntr(?:y|ies)|fetchEntr(?:y|ies)|getContentType)\s*\(\s*['"`](\w[\w-]*)['"`]/
		);
		if (funcCallMatch) {
			result.set(funcCallMatch[1], funcCallMatch[2]);
		}

		// Direct assignment: const pageEntry = response.entry  (with 'page' in name)
		const namedVarMatch = line.match(
			/(?:const|let|var)\s+(\w*(?:entry|Entry|entries|Entries)\w*)\s*=/i
		);
		if (namedVarMatch) {
			// Try to infer content type from variable name: pageEntry → page, blogPostEntries → blog_post
			const varName = namedVarMatch[1];
			const ctGuess = _inferContentTypeFromVarName(varName);
			if (ctGuess) {
				result.set(varName, ctGuess);
			}
		}
	}

	return result;
}

/** Tries to infer a content type UID from a variable name like `pageEntry` → `page`. */
function _inferContentTypeFromVarName(varName: string): string | undefined {
	// Strip common suffixes
	const stripped = varName
		.replace(/(?:Entry|Entries|Data|Response|Result|Content|Item|Items)$/i, '')
		.trim();

	if (!stripped || stripped.length < 2) { return undefined; }

	// Convert camelCase to snake_case
	return stripped
		.replace(/([a-z])([A-Z])/g, '$1_$2')
		.toLowerCase();
}

// ---------------------------------------------------------------------------
// Phase 2: Find entry variables
// ---------------------------------------------------------------------------

/**
 * Identifies variables that hold Contentstack entry data.
 * Returns a map of `variableName → contentTypeUid`.
 */
function _findEntryVariables(
	lines: string[],
	ctMap: Map<string, string>,
): Map<string, string> {
	const entryVars = new Map<string, string>();

	// Carry over known content type associations
	for (const [varName, ctUid] of ctMap) {
		if (!varName.startsWith('__')) {
			entryVars.set(varName, ctUid);
		}
	}

	// Default content type from SDK/helper patterns
	const defaultCt = ctMap.get('__sdk__') ?? ctMap.get('__helper__') ?? '';

	for (const line of lines) {
		// entry = await stack.ContentType('x').Entry('y').fetch()
		const fetchMatch = line.match(
			/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?.*\.(?:fetch|find|findOne|toJSON)\s*\(/
		);
		if (fetchMatch && defaultCt) {
			entryVars.set(fetchMatch[1], defaultCt);
		}

		// Common parameter names in Next.js data fetching
		const paramMatch = line.match(
			/(?:function|const|async)\s+\w+\s*\([^)]*\b(entry|data|result|response|content|page|post|article)\b[^)]*\)/i
		);
		if (paramMatch && defaultCt) {
			entryVars.set(paramMatch[1], defaultCt);
		}

		// Hooks: const { data: entry } = useContentstackEntry(...)
		const hookMatch = line.match(
			/(?:const|let)\s+\{[^}]*(?:data\s*:\s*(\w+)|(\w+))[^}]*\}\s*=\s*(?:await\s+)?use\w*(?:Entry|Content|Stack)/
		);
		if (hookMatch) {
			const varName = hookMatch[1] ?? hookMatch[2];
			if (varName) {
				entryVars.set(varName, defaultCt);
			}
		}

		// Generic: const entry = props.entry / data.entry / response.entry
		const propMatch = line.match(
			/(?:const|let|var)\s+(\w+)\s*=\s*(?:\w+\.)+(?:entry|entries|data|result)\b/i
		);
		if (propMatch && defaultCt) {
			entryVars.set(propMatch[1], defaultCt);
		}
	}

	// If no specific variables found but we have a default content type,
	// add common entry variable names
	if (entryVars.size === 0 && defaultCt) {
		for (const name of ['entry', 'data', 'result', 'content', 'page']) {
			entryVars.set(name, defaultCt);
		}
	}

	return entryVars;
}

// ---------------------------------------------------------------------------
// Phase 3: Extract field accesses
// ---------------------------------------------------------------------------

/** Extracts `varName.fieldName` dot-access patterns. */
function _extractDotAccesses(
	line: string,
	lineNum: number,
	varName: string,
	ctUid: string,
	accesses: ExtractedFieldAccess[],
): void {
	// Match: entry.fieldName (not followed by `(` which would be a method call)
	const regex = new RegExp(
		`\\b${_escapeRegex(varName)}\\.([a-zA-Z_][a-zA-Z0-9_]*)(?!\\s*\\()`,
		'g'
	);
	let match;
	while ((match = regex.exec(line)) !== null) {
		const fieldName = match[1];
		if (_isBuiltinProperty(fieldName)) { continue; }
		accesses.push({
			fieldName,
			contentTypeUid: ctUid || undefined,
			line: lineNum,
			sourceLine: line.trim(),
			inferenceMethod: ctUid ? 'variable-trace' : 'unknown',
		});
	}
}

/** Extracts `varName['fieldName']` bracket-access patterns. */
function _extractBracketAccesses(
	line: string,
	lineNum: number,
	varName: string,
	ctUid: string,
	accesses: ExtractedFieldAccess[],
): void {
	const regex = new RegExp(
		`\\b${_escapeRegex(varName)}\\[\\s*['"\`]([a-zA-Z_][a-zA-Z0-9_]*)['"\`]\\s*\\]`,
		'g'
	);
	let match;
	while ((match = regex.exec(line)) !== null) {
		accesses.push({
			fieldName: match[1],
			contentTypeUid: ctUid || undefined,
			line: lineNum,
			sourceLine: line.trim(),
			inferenceMethod: ctUid ? 'variable-trace' : 'unknown',
		});
	}
}

/** Extracts `varName?.fieldName` optional chaining. */
function _extractOptionalChaining(
	line: string,
	lineNum: number,
	varName: string,
	ctUid: string,
	accesses: ExtractedFieldAccess[],
): void {
	const regex = new RegExp(
		`\\b${_escapeRegex(varName)}\\?\\.([a-zA-Z_][a-zA-Z0-9_]*)(?!\\s*\\()`,
		'g'
	);
	let match;
	while ((match = regex.exec(line)) !== null) {
		const fieldName = match[1];
		if (_isBuiltinProperty(fieldName)) { continue; }
		accesses.push({
			fieldName,
			contentTypeUid: ctUid || undefined,
			line: lineNum,
			sourceLine: line.trim(),
			inferenceMethod: ctUid ? 'variable-trace' : 'unknown',
		});
	}
}

/** Extracts fields from destructuring: `const { field1, field2 } = entry` */
function _extractDestructuring(
	line: string,
	lineNum: number,
	entryVars: Map<string, string>,
	accesses: ExtractedFieldAccess[],
): void {
	// Match: const { a, b, c: alias } = varName
	const destructMatch = line.match(
		/(?:const|let|var)\s+\{\s*([^}]+)\}\s*=\s*(\w+)/
	);
	if (!destructMatch) { return; }

	const varsBlock = destructMatch[1];
	const sourceVar = destructMatch[2];
	const ctUid = entryVars.get(sourceVar);

	if (ctUid === undefined) { return; }

	// Parse destructured field names (handles `fieldName`, `fieldName: alias`, `fieldName = default`)
	const fields = varsBlock.split(',').map((f) => f.trim()).filter(Boolean);
	for (const field of fields) {
		const fieldName = field.split(/\s*[:=]\s*/)[0].trim();
		if (!fieldName || fieldName.startsWith('...') || _isBuiltinProperty(fieldName)) {
			continue;
		}
		accesses.push({
			fieldName,
			contentTypeUid: ctUid || undefined,
			line: lineNum,
			sourceLine: line.trim(),
			inferenceMethod: ctUid ? 'variable-trace' : 'unknown',
		});
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Properties that are part of JavaScript/Entry objects, not CMS fields. */
const BUILTIN_PROPERTIES = new Set([
	'length', 'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex',
	'includes', 'indexOf', 'push', 'pop', 'shift', 'unshift', 'slice',
	'splice', 'concat', 'join', 'sort', 'reverse', 'keys', 'values',
	'entries', 'toString', 'valueOf', 'hasOwnProperty', 'constructor',
	'prototype', 'then', 'catch', 'finally', 'toJSON', 'fetch',
	'locale', 'uid', '_version', 'created_at', 'updated_at',
	'created_by', 'updated_by', 'ACL', 'tags', '_metadata',
	'publish_details', '_in_progress',
]);

function _isBuiltinProperty(name: string): boolean {
	return BUILTIN_PROPERTIES.has(name);
}

function _isSkippableLine(line: string): boolean {
	const trimmed = line.trim();
	return (
		trimmed.startsWith('//') ||
		trimmed.startsWith('*') ||
		trimmed.startsWith('/*') ||
		trimmed.startsWith('---') ||
		trimmed.startsWith('+++') ||
		trimmed.startsWith('@@') ||
		trimmed === ''
	);
}

function _escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
