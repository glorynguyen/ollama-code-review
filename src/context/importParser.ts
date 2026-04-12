/**
 * F-008: Multi-File Contextual Analysis — Import Parser
 *
 * Extracts import/require statements from JavaScript, TypeScript, JSX, and TSX
 * source files. Handles ES6 static imports, CommonJS require(), and dynamic
 * import() calls. Only relative imports are actionable for context gathering
 * (node_modules are excluded), but all imports are reported for completeness.
 */

import { ParsedImport } from './types';

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Regex patterns for import styles that cannot be handled by the richer
 * ES6 clause parser (CommonJS `require` and dynamic `import()`).
 * ES6 static imports and re-exports are handled by `tryParseEs6Line`.
 */
const PATTERNS = {
	/**
	 * CommonJS require:
	 *   const foo = require('module')
	 *   require('module')
	 */
	commonjsRequire: /(?:^|\s|=)\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,

	/**
	 * Dynamic import():
	 *   import('module')
	 *   const m = await import('module')
	 * Only matches string-literal specifiers; template literals are skipped.
	 */
	dynamicImport: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
};

// ---------------------------------------------------------------------------
// ES6 clause helpers
// ---------------------------------------------------------------------------

/** Intermediate result from parsing one ES6 import/export line. */
interface Es6ParseResult {
	specifier: string;
	symbols: string[];
	isNamespace: boolean;
}

/**
 * Attempt to parse an ES6 static import or re-export line.
 *
 * Handles:
 *   import 'side-effect'
 *   import type 'module'
 *   import Foo from 'module'
 *   import { foo, bar as baz } from 'module'
 *   import type { Foo } from 'module'
 *   import * as ns from 'module'
 *   import Foo, { bar } from 'module'
 *   export { foo, bar } from 'module'
 *   export * from 'module'
 *   export * as ns from 'module'
 *   export type { Foo } from 'module'
 *
 * @param line - A single (possibly normalized) source line.
 * @returns Parsed result, or `null` if the line is not an ES6 import/export.
 */
function tryParseEs6Line(line: string): Es6ParseResult | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('import') && !trimmed.startsWith('export')) {
		return null;
	}

	// Import with a `from` clause
	const fromMatch = trimmed.match(/\bfrom\s+['"]([^'"]+)['"]/);
	if (fromMatch) {
		const specifier = fromMatch[1];
		// Extract the import clause: everything between the leading keyword
		// and the `from '...'` section.
		const clauseText = trimmed
			.replace(/^(?:import|export)\s+(?:type\s+)?/, '')
			.replace(/\s*\bfrom\s+['"][^'"]+['"].*$/, '')
			.trim();
		return { specifier, ...parseImportClause(clauseText) };
	}

	// Side-effect import: import 'module' (no clause, no `from`)
	const sideEffectMatch = trimmed.match(/^import\s+(?:type\s+)?['"]([^'"]+)['"]/);
	if (sideEffectMatch) {
		return { specifier: sideEffectMatch[1], symbols: [], isNamespace: false };
	}

	return null;
}

/**
 * Parse the import clause (the portion between `import`/`export` and `from`)
 * and extract imported symbol names.
 *
 * @param clause - Raw clause text, e.g. `{ foo, bar as baz }`, `* as ns`, `Default`.
 * @returns Symbol names and a namespace flag.
 */
function parseImportClause(clause: string): { symbols: string[]; isNamespace: boolean } {
	if (!clause) {
		return { symbols: [], isNamespace: false };
	}

	// Namespace import/export: * as foo  or  *
	if (clause.includes('*')) {
		return { symbols: [], isNamespace: true };
	}

	const symbols: string[] = [];

	// Default import: starts with a bare identifier (not a `{`)
	// e.g. `DefaultImport` or `DefaultImport, { named }`
	if (!clause.trim().startsWith('{') && /^[\w$]/.test(clause.trim())) {
		symbols.push('default');
	}

	// Named imports: { foo, bar as baz, type Qux }
	const namedMatch = clause.match(/\{([^}]+)\}/);
	if (namedMatch) {
		const named = namedMatch[1]
			.split(',')
			.map(s =>
				s.trim()
					.replace(/^type\s+/, '')        // strip TypeScript "type" modifier
					.replace(/\s+as\s+[\w$]+$/, '') // strip "as alias" renaming
					.trim(),
			)
			.filter(s => s.length > 0);
		symbols.push(...named);
	}

	return { symbols, isNamespace: false };
}

/** Return true when `specifier` refers to a workspace-relative path. */
function isRelativeSpecifier(specifier: string): boolean {
	return (
		specifier.startsWith('.') ||
		specifier.startsWith('src/') ||
		specifier.startsWith('@/')
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collapse multi-line import/export brace blocks into a single line so that
 * the line-by-line regex pass can match them correctly.
 *
 * Example — turns:
 *   export {
 *       gatherContext,
 *       formatContextForPrompt,
 *   } from './contextGatherer';
 *
 * into:
 *   export { gatherContext, formatContextForPrompt, } from './contextGatherer';
 */
function normalizeMultilineBlocks(content: string): string {
	const lines = content.split('\n');
	const result: string[] = [];
	let accumulator: string | null = null;

	for (const line of lines) {
		if (accumulator !== null) {
			// Strip inline comments before processing so `}` inside a comment
			// doesn't prematurely close the block.
			const cleanLine = line.replace(/\/\/.*$/, '').trim();

			if (cleanLine) {
				accumulator += ' ' + cleanLine;
			}

			// Check if the real code (not a comment) contains the closing brace.
			if (line.replace(/\/\/.*$/, '').includes('}')) {
				result.push(accumulator.replace(/\s+/g, ' ').trim());
				accumulator = null;
			}
		} else {
			const opensBlock = /^\s*(?:export|import)\s+(?:type\s+)?\{/.test(line);
			// Check for `}` only in non-comment code.
			const closesOnSameLine = line.replace(/\/\/.*$/, '').includes('}');

			if (opensBlock && !closesOnSameLine) {
				accumulator = line.trimEnd();
			} else {
				result.push(line);
			}
		}
	}

	if (accumulator !== null) {
		result.push(accumulator);
	}

	return result.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse all import/require statements from the given file content.
 *
 * @param content - Full source file text.
 * @returns Array of parsed imports, one per unique specifier.
 */
export function parseImports(content: string): ParsedImport[] {
	const lines = normalizeMultilineBlocks(content).split('\n');
	const seen = new Set<string>();
	const imports: ParsedImport[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Skip comment-only lines (simple heuristic — not a full parser)
		const trimmed = line.trimStart();
		if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
			continue;
		}

		// ES6 static import / re-export (captures symbol names)
		const es6Result = tryParseEs6Line(line);
		if (es6Result) {
			if (!seen.has(es6Result.specifier)) {
				seen.add(es6Result.specifier);
				imports.push({
					specifier: es6Result.specifier,
					isRelative: isRelativeSpecifier(es6Result.specifier),
					line: i + 1,
					symbols: es6Result.symbols,
					isNamespace: es6Result.isNamespace,
				});
			}
			continue; // don't double-count with CJS/dynamic patterns below
		}

		// CommonJS require / dynamic import — include full file (no symbol info)
		const cjsMatch = line.match(PATTERNS.commonjsRequire);
		const dynMatch = cjsMatch ? null : line.match(PATTERNS.dynamicImport);
		const m = cjsMatch ?? dynMatch;
		if (m && m[1] && !seen.has(m[1])) {
			seen.add(m[1]);
			imports.push({
				specifier: m[1],
				isRelative: isRelativeSpecifier(m[1]),
				line: i + 1,
				symbols: [],
				isNamespace: true, // always include the full file for CJS/dynamic
			});
		}
	}

	return imports;
}

/**
 * Extract the list of changed file paths from a unified diff string.
 * Re-uses the same logic as `parseDiffIntoFiles` from diffFilter.ts but
 * only returns the file paths (b-side).
 *
 * @param diff - Unified diff text (e.g. `git diff` output).
 * @returns Array of workspace-relative file paths that were changed.
 */
export function extractChangedFiles(diff: string): string[] {
	const files: string[] = [];
	const regex = /^diff --git a\/.+? b\/(.+?)$/gm;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(diff)) !== null) {
		files.push(match[1]);
	}

	return files;
}
