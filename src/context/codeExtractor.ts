/**
 * F-008: Multi-File Contextual Analysis — Symbol-based Code Extractor
 *
 * Provides "tree-shaking" for context gathering: instead of including an
 * entire imported file, only the specific exported symbols that are actually
 * imported by the changed files are extracted. This reduces token usage and
 * improves LLM focus.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract only the exported code blocks for the requested `symbols` from
 * `content`. Uses a bracket-counting heuristic to find block boundaries,
 * making it fast enough for the VS Code Extension Host with no external
 * AST dependencies.
 *
 * ### Algorithm
 * 1. Strip comments and string literals from a working copy to avoid false
 *    bracket matches inside quoted content or comments.
 * 2. For each requested symbol, locate the `export [keyword] symbolName`
 *    declaration line in the stripped copy.
 * 3. Starting from that line, increment a depth counter on `{` and decrement
 *    on `}`. The block ends when the counter returns to 0 after the first
 *    opening brace.
 * 4. Extract the corresponding lines from the *original* (unstripped) content.
 * 5. Concatenate all extracted blocks with a `// Extracted symbol: name`
 *    header for each one.
 *
 * Falls back gracefully: if a symbol cannot be located (e.g. it is declared
 * inside a namespace or uses a non-standard export form), it is silently
 * omitted. The caller in {@link contextGatherer} will fall back to the full
 * file if the returned string is empty.
 *
 * @param content - Full source file text.
 * @param symbols - Names of exported symbols to extract. The special value
 *   `"default"` extracts the `export default` block.
 * @returns Concatenated extracted blocks separated by blank lines, or an
 *   empty string if no symbols could be located.
 */
export function extractSymbolBlocks(content: string, symbols: string[]): string {
	if (symbols.length === 0) {
		return '';
	}

	const originalLines = content.split('\n');
	const strippedContent = stripCommentsAndStrings(content);
	const strippedLines = strippedContent.split('\n');

	const blocks: string[] = [];
	const seen = new Set<string>();

	for (const symbol of symbols) {
		if (seen.has(symbol)) {
			continue;
		}
		seen.add(symbol);

		const startLine =
			symbol === 'default'
				? findDefaultExportLine(strippedLines)
				: findExportLine(strippedLines, symbol);

		if (startLine === -1) {
			continue; // symbol not found — silently skip
		}

		const endLine = findBlockEnd(strippedLines, startLine);
		const rawBlock = originalLines.slice(startLine, endLine + 1).join('\n');
		blocks.push(`// Extracted symbol: ${symbol}\n${rawBlock}`);
	}

	return blocks.join('\n\n');
}

/**
 * Identifies the exported symbols (functions / classes / const / etc.) whose
 * definitions contain at least one of the modified lines.
 *
 * The algorithm mirrors the one used by {@link extractSymbolBlocks}:
 * 1. Strip comments and string literals to avoid false bracket matches.
 * 2. Scan each line for an `export` declaration to record `{ name, start, end }`.
 * 3. For each named symbol, check whether any changed line falls within its range.
 *
 * @param content      - Full source file text.
 * @param changedLines - Set of 1-based line numbers that were modified.
 * @returns Names of affected exported symbols (may include `"default"`).
 */
export function findAffectedSymbols(content: string, changedLines: Set<number>): string[] {
	const strippedContent = stripCommentsAndStrings(content);
	const strippedLines = strippedContent.split('\n');

	const symbolsInFile: { name: string; start: number; end: number }[] = [];

	for (let i = 0; i < strippedLines.length; i++) {
		const line = strippedLines[i];
		const match = line.match(
			/export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum)\s+([\w$]+)/,
		);

		if (match) {
			const name = match[1];
			const end = findBlockEnd(strippedLines, i);
			symbolsInFile.push({ name, start: i, end });
		} else if (/^\s*export\s+default\b/.test(line)) {
			const end = findBlockEnd(strippedLines, i);
			symbolsInFile.push({ name: 'default', start: i, end });
		}
	}

	const affected = new Set<string>();
	for (const symbol of symbolsInFile) {
		for (const lineNum of changedLines) {
			// lineNum is 1-based; start/end are 0-based indices
			if (lineNum >= symbol.start + 1 && lineNum <= symbol.end + 1) {
				affected.add(symbol.name);
				break;
			}
		}
	}

	return Array.from(affected);
}

// ---------------------------------------------------------------------------
// Internal helpers — block location
// ---------------------------------------------------------------------------

/** Escape special regex metacharacters in a symbol name. */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the 0-based line index where `export <keyword> symbolName` is declared.
 *
 * Supports:
 *   `export function`, `export async function`, `export function*`
 *   `export const`, `export let`, `export var`
 *   `export class`, `export abstract class`
 *   `export interface`, `export type`, `export enum`
 *   `export declare ...` (ambient declarations)
 *
 * @param lines   - Comment/string-stripped source lines.
 * @param symbol  - The exact export name to search for.
 * @returns 0-based line index, or -1 if not found.
 */
function findExportLine(lines: string[], symbol: string): number {
	const esc = escapeRegex(symbol);
	const pattern = new RegExp(
		`^\\s*export\\s+(?:declare\\s+)?(?:async\\s+)?(?:abstract\\s+)?` +
		`(?:function\\s*\\*?|const|let|var|class|interface|type|enum)\\s+${esc}\\b`,
	);
	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i])) {
			return i;
		}
	}
	return -1;
}

/**
 * Find the 0-based line index of the `export default` declaration.
 *
 * @param lines - Comment/string-stripped source lines.
 * @returns 0-based line index, or -1 if not found.
 */
function findDefaultExportLine(lines: string[]): number {
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*export\s+default\b/.test(lines[i])) {
			return i;
		}
	}
	return -1;
}

/**
 * Find the last line (0-based) of the code block that begins at `startLine`,
 * using a bracket-depth heuristic on the comment/string-stripped `lines`.
 *
 * ### Rules
 * - A `{` increments the depth counter; a `}` decrements it.
 * - The block ends on the line where the counter first returns to 0 after
 *   having been incremented at least once.
 * - For brace-less declarations (e.g. `export const x = 5;` or
 *   `export type Alias = A | B;`), the block ends at the first line that
 *   contains a `;` after the start.
 *
 * @param lines     - Comment/string-stripped source lines.
 * @param startLine - 0-based index of the declaration line.
 * @returns 0-based index of the last line of the block.
 */
function findBlockEnd(lines: string[], startLine: number): number {
	let depth = 0;
	let started = false; // true once the first '{' has been seen

	for (let i = startLine; i < lines.length; i++) {
		const line = lines[i];

		for (let c = 0; c < line.length; c++) {
			const ch = line[c];
			if (ch === '{') {
				depth++;
				started = true;
			} else if (ch === '}') {
				depth--;
				if (started && depth === 0) {
					return i;
				}
			}
		}

		// Brace-less expressions end at the first line with a semicolon.
		if (!started && line.includes(';')) {
			return i;
		}
	}

	// Single-line brace-less export with no trailing `;` in the stripped text
	if (!started) {
		return startLine;
	}

	// Unterminated block — include everything to the end of the file
	return lines.length - 1;
}

// ---------------------------------------------------------------------------
// Internal helpers — comment/string stripping
// ---------------------------------------------------------------------------

/**
 * Return a copy of `src` with all line comments (`//`), block comments
 * (`/* … *\/`), and string/template literals replaced by spaces, while
 * preserving all newlines so that line numbers remain accurate.
 *
 * This "safe" copy is used exclusively for bracket-depth counting; the
 * original source is always used when extracting the actual text.
 *
 * @param src - Raw TypeScript/JavaScript source text.
 * @returns Stripped version with non-newline chars inside comments/strings
 *   replaced by spaces.
 */
function stripCommentsAndStrings(src: string): string {
	const N = src.length;
	let result = '';
	let i = 0;

	while (i < N) {
		const ch = src[i];

		// Block comment: /* ... */
		if (ch === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i + 2);
			if (end === -1) {
				// Unterminated block comment — replace rest of file
				result += src.slice(i).replace(/[^\n]/g, ' ');
				break;
			}
			const chunk = src.slice(i, end + 2);
			result += chunk.replace(/[^\n]/g, ' ');
			i = end + 2;
			continue;
		}

		// Line comment: // ...
		if (ch === '/' && src[i + 1] === '/') {
			const end = src.indexOf('\n', i);
			if (end === -1) {
				result += ' '.repeat(N - i);
				break;
			}
			// Replace comment chars with spaces but keep the newline
			result += ' '.repeat(end - i);
			i = end; // newline consumed by the main `result += ch` below
			continue;
		}

		// Double-quoted string: "..."
		if (ch === '"') {
			let j = i + 1;
			while (j < N && src[j] !== '"') {
				if (src[j] === '\\') { j++; } // skip escaped character
				if (j < N && src[j] === '\n') { break; } // unterminated line
				j++;
			}
			const chunk = src.slice(i, j + 1);
			result += chunk.replace(/[^\n]/g, ' ');
			i = j + 1;
			continue;
		}

		// Single-quoted string: '...'
		if (ch === "'") {
			let j = i + 1;
			while (j < N && src[j] !== "'") {
				if (src[j] === '\\') { j++; }
				if (j < N && src[j] === '\n') { break; }
				j++;
			}
			const chunk = src.slice(i, j + 1);
			result += chunk.replace(/[^\n]/g, ' ');
			i = j + 1;
			continue;
		}

		// Template literal: `...` (handles nested ${...} expressions)
		if (ch === '`') {
			let j = i + 1;
			let exprDepth = 0;
			while (j < N) {
				if (src[j] === '\\') { j += 2; continue; }
				if (src[j] === '`' && exprDepth === 0) { j++; break; }
				if (src[j] === '$' && src[j + 1] === '{') { exprDepth++; j += 2; continue; }
				if (src[j] === '}' && exprDepth > 0) { exprDepth--; j++; continue; }
				j++;
			}
			const chunk = src.slice(i, j);
			result += chunk.replace(/[^\n]/g, ' ');
			i = j;
			continue;
		}

		result += ch;
		i++;
	}

	return result;
}
