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
 * Regex patterns for different import styles.
 * Each pattern is applied line-by-line for simplicity and reliability.
 */
const PATTERNS = {
	/**
	 * ES6 static imports:
	 *   import foo from 'module'
	 *   import { foo } from 'module'
	 *   import * as foo from 'module'
	 *   import 'module'  (side-effect)
	 */
	es6Import: /^\s*import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/,

	/**
	 * ES6 re-exports:
	 *   export { foo } from 'module'
	 *   export * from 'module'
	 */
	es6ReExport: /^\s*export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/,

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
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse all import/require statements from the given file content.
 *
 * @param content - Full source file text.
 * @returns Array of parsed imports, one per unique specifier.
 */
export function parseImports(content: string): ParsedImport[] {
	const lines = content.split('\n');
	const seen = new Set<string>();
	const imports: ParsedImport[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Skip comment-only lines (simple heuristic — not a full parser)
		const trimmed = line.trimStart();
		if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
			continue;
		}

		// Try each pattern against the line
		for (const pattern of Object.values(PATTERNS)) {
			const match = line.match(pattern);
			if (match && match[1]) {
				const specifier = match[1];
				if (!seen.has(specifier)) {
					seen.add(specifier);
					imports.push({
						specifier,
						isRelative: specifier.startsWith('.'),
						line: i + 1,
					});
				}
			}
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
