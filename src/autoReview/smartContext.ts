/**
 * F-043 helper: Smart context builder.
 *
 * Given a git diff, this module uses VS Code's language server APIs to:
 *   1. Find the innermost function/method that wraps each changed line.
 *   2. Extract the names of functions called inside that wrapping function.
 *   3. BFS-expand the call graph up to `maxDepth` levels (default 2), following
 *      definitions via `executeDefinitionProvider`.
 *   4. Collect relevant `import` statements from the changed file.
 *
 * The result is a structured context string that is prepended to the AI prompt,
 * giving the model the surrounding business logic without sending entire files.
 *
 * Complexity notes:
 *   - Language server calls are async and can be slow (100-500 ms each).
 *   - We cap the BFS at `maxFunctions` total nodes and `maxDepth` levels.
 *   - Each function body is truncated to `maxCharsPerFn` characters.
 *   - The total context is capped at `totalCharBudget` characters.
 *   - Definitions inside `node_modules` or `.d.ts` files are skipped.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { parseChangedLineNumbers } from './gitDiff';
import type { MonorepoResolver } from './monorepo';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_DEPTH = 2;
const MAX_FUNCTIONS = 8;
const MAX_CHARS_PER_FN = 1_500;
const TOTAL_CHAR_BUDGET = 6_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SmartContextResult {
	/** The formatted context string ready to inject into the AI prompt. */
	context: string;
	/** Number of functions included. */
	functionCount: number;
	/** Whether the total character budget was reached. */
	budgetExhausted: boolean;
}

/**
 * Options for {@link buildSmartContext}.
 * All fields are optional — existing callers are unaffected.
 */
export interface SmartContextOptions {
	/**
	 * When provided, the BFS call-graph traversal will follow definitions into
	 * monorepo workspace packages even when they resolve through `node_modules`
	 * symlinks or `dist/` directories.
	 */
	resolver?: MonorepoResolver;

	/**
	 * Absolute path of the workspace root.  Required when `resolver` is set so
	 * that package discovery can locate `package.json` / `pnpm-workspace.yaml`.
	 * Falls back to the file's parent directory when omitted.
	 */
	workspaceRoot?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a smart context string for the changed lines in `diff` of `fileUri`.
 *
 * @param fileUri  The URI of the saved file.
 * @param diff     The unified diff string (from getGitDiff).
 * @param options  Optional settings — pass a {@link MonorepoResolver} to follow
 *                 cross-package definitions in monorepo workspaces.
 */
export async function buildSmartContext(
	fileUri: vscode.Uri,
	diff: string,
	options?: SmartContextOptions,
): Promise<SmartContextResult> {
	const changedLines = parseChangedLineNumbers(diff);
	if (changedLines.length === 0) {
		return { context: '', functionCount: 0, budgetExhausted: false };
	}

	// Open the document so language servers can provide symbols.
	let doc: vscode.TextDocument;
	try {
		doc = await vscode.workspace.openTextDocument(fileUri);
	} catch {
		return { context: '', functionCount: 0, budgetExhausted: false };
	}

	// Get imports from the changed file.
	const imports = _extractImports(doc.getText());

	// Step 1 — find the innermost enclosing function(s) for each changed line.
	const symbols = await _getDocumentSymbols(fileUri);
	const enclosingFns = _findEnclosingFunctions(symbols, changedLines);

	if (enclosingFns.length === 0) {
		// No function context found — just return the imports.
		if (imports.length === 0) {
			return { context: '', functionCount: 0, budgetExhausted: false };
		}
		const ctx = `## Imports\n\`\`\`\n${imports.join('\n')}\n\`\`\`\n`;
		return { context: ctx, functionCount: 0, budgetExhausted: false };
	}

	// Step 2 — BFS to collect functions reachable from the enclosing function(s).
	const sections: Array<{ depth: number; label: string; body: string }> = [];
	let totalChars = 0;
	let budgetExhausted = false;

	// visited key: `${absoluteFilePath}::${fnName}::${startLine}`
	const visited = new Set<string>();
	// Queue entries: { uri, symbol, depth }
	type QueueEntry = { uri: vscode.Uri; symbol: vscode.DocumentSymbol; depth: number };
	const queue: QueueEntry[] = enclosingFns.map(sym => ({ uri: fileUri, symbol: sym, depth: 0 }));

	while (queue.length > 0 && sections.length < MAX_FUNCTIONS) {
		const entry = queue.shift()!;
		const { uri, symbol, depth } = entry;
		const visitedKey = `${uri.fsPath}::${symbol.name}::${symbol.range.start.line}`;
		if (visited.has(visitedKey)) { continue; }
		visited.add(visitedKey);

		if (totalChars >= TOTAL_CHAR_BUDGET) {
			budgetExhausted = true;
			break;
		}

		// Read the function body.
		let fnDoc: vscode.TextDocument;
		try {
			fnDoc = await vscode.workspace.openTextDocument(uri);
		} catch {
			continue;
		}

		const rawBody = fnDoc.getText(symbol.range);
		const body = rawBody.length > MAX_CHARS_PER_FN
			? rawBody.slice(0, MAX_CHARS_PER_FN) + '\n// … truncated'
			: rawBody;

		const relPath = vscode.workspace.asRelativePath(uri);
		const label = depth === 0
			? `Changed function: \`${symbol.name}\` (${relPath})`
			: `Called function: \`${symbol.name}\` (${relPath}, depth ${depth})`;

		sections.push({ depth, label, body });
		totalChars += body.length;

		// Step 3 — extract call names and BFS-expand if within depth limit.
		if (depth < MAX_DEPTH) {
			const callNames = _extractCallNames(rawBody);
			for (const callName of callNames) {
				if (sections.length + queue.length >= MAX_FUNCTIONS) { break; }

				// Find the call site position so we can use executeDefinitionProvider.
				const callPos = _findCallPosition(fnDoc, symbol.range, callName);
				if (!callPos) { continue; }

				const defLocations = await _getDefinition(uri, callPos);
				for (const loc of defLocations) {
					const defUri = loc.uri;
					// Skip node_modules and type-declaration files — unless the
					// monorepo resolver recognises the path as a local workspace package.
					if (await _shouldSkip(defUri, options)) { continue; }

					// Load the definition document and find the symbol at that location.
					let defDoc: vscode.TextDocument;
					try {
						defDoc = await vscode.workspace.openTextDocument(defUri);
					} catch {
						continue;
					}

					const defSymbols = await _getDocumentSymbols(defUri);
					const defSym = _findSymbolAtLine(defSymbols, loc.range.start.line);
					if (!defSym) { continue; }

					const defKey = `${defUri.fsPath}::${defSym.name}::${defSym.range.start.line}`;
					if (!visited.has(defKey)) {
						queue.push({ uri: defUri, symbol: defSym, depth: depth + 1 });
					}
				}
			}
		}
	}

	if (sections.length === 0) {
		return { context: '', functionCount: 0, budgetExhausted: false };
	}

	// Build the output string.
	const lines: string[] = [];

	if (imports.length > 0) {
		lines.push('## Relevant Imports');
		lines.push('```');
		lines.push(imports.join('\n'));
		lines.push('```');
		lines.push('');
	}

	for (const sec of sections) {
		lines.push(`## ${sec.label}`);
		const lang = _inferLanguage(fileUri);
		lines.push(`\`\`\`${lang}`);
		lines.push(sec.body);
		lines.push('```');
		lines.push('');
	}

	if (budgetExhausted) {
		lines.push('_… additional called functions omitted (token budget reached)_');
	}

	return {
		context: lines.join('\n'),
		functionCount: sections.length,
		budgetExhausted,
	};
}

/**
 * Build a context bundle for the function at a specific cursor position.
 *
 * Unlike {@link buildSmartContext} which derives context from a diff, this
 * function takes a file URI and cursor position, finds the enclosing function,
 * and BFS-expands its call graph — returning each function body with its
 * file location.  Designed for "Copy Function with Imports" and similar
 * interactive commands.
 *
 * @param fileUri   The document URI.
 * @param position  The cursor position (must be inside a function).
 * @param options   Optional monorepo resolver for cross-package traversal.
 * @returns Array of collected function sections, or empty if no function found.
 */
export interface FunctionContextEntry {
	/** Workspace-relative file path. */
	relativePath: string;
	/** Function/method name. */
	name: string;
	/** Full function body text. */
	body: string;
	/** BFS depth (0 = the target function). */
	depth: number;
}

export interface FunctionContextResult {
	/** The target function at depth 0. */
	target: FunctionContextEntry | undefined;
	/** All collected functions (including target). */
	entries: FunctionContextEntry[];
	/** Import lines from the file containing the target function. */
	imports: string[];
	/** Whether the budget was exhausted. */
	budgetExhausted: boolean;
}

export async function buildFunctionContext(
	fileUri: vscode.Uri,
	position: vscode.Position,
	options?: SmartContextOptions,
): Promise<FunctionContextResult> {
	const empty: FunctionContextResult = { target: undefined, entries: [], imports: [], budgetExhausted: false };

	let doc: vscode.TextDocument;
	try {
		doc = await vscode.workspace.openTextDocument(fileUri);
	} catch {
		return empty;
	}

	const symbols = await _getDocumentSymbols(fileUri);
	const flat = _flattenSymbols(symbols).filter(s => FN_KINDS.has(s.kind));

	// Find the innermost function containing the cursor.
	const candidates = flat.filter(
		s => s.range.start.line <= position.line && s.range.end.line >= position.line,
	);
	if (candidates.length === 0) { return empty; }

	candidates.sort(
		(a, b) => (a.range.end.line - a.range.start.line) - (b.range.end.line - b.range.start.line),
	);
	const targetSymbol = candidates[0];

	// Collect imports from the file.
	const imports = _extractImports(doc.getText());

	// BFS call-graph expansion (same algorithm as buildSmartContext).
	const COPY_MAX_DEPTH = 3;
	const COPY_MAX_FUNCTIONS = 15;
	const COPY_CHAR_BUDGET = 64_000;
	const COPY_PER_FN = 8_000;

	const entries: FunctionContextEntry[] = [];
	let totalChars = 0;
	let budgetExhausted = false;

	const visited = new Set<string>();
	type QueueEntry = { uri: vscode.Uri; symbol: vscode.DocumentSymbol; depth: number };
	const queue: QueueEntry[] = [{ uri: fileUri, symbol: targetSymbol, depth: 0 }];

	while (queue.length > 0 && entries.length < COPY_MAX_FUNCTIONS) {
		const entry = queue.shift()!;
		const { uri, symbol, depth } = entry;
		const visitedKey = `${uri.fsPath}::${symbol.name}::${symbol.range.start.line}`;
		if (visited.has(visitedKey)) { continue; }
		visited.add(visitedKey);

		if (totalChars >= COPY_CHAR_BUDGET) {
			budgetExhausted = true;
			break;
		}

		let fnDoc: vscode.TextDocument;
		try {
			fnDoc = await vscode.workspace.openTextDocument(uri);
		} catch {
			continue;
		}

		const rawBody = fnDoc.getText(symbol.range);
		const body = rawBody.length > COPY_PER_FN
			? rawBody.slice(0, COPY_PER_FN) + '\n// … truncated'
			: rawBody;

		const relPath = vscode.workspace.asRelativePath(uri);
		entries.push({ relativePath: relPath, name: symbol.name, body, depth });
		totalChars += body.length;

		// BFS-expand call graph.
		if (depth < COPY_MAX_DEPTH) {
			const callNames = _extractCallNames(rawBody);
			for (const callName of callNames) {
				if (entries.length + queue.length >= COPY_MAX_FUNCTIONS) { break; }

				const callPos = _findCallPosition(fnDoc, symbol.range, callName);
				if (!callPos) { continue; }

				const defLocations = await _getDefinition(uri, callPos);
				for (const loc of defLocations) {
					if (await _shouldSkip(loc.uri, options)) { continue; }

					const defSymbols = await _getDocumentSymbols(loc.uri);
					const defSym = _findSymbolAtLine(defSymbols, loc.range.start.line);
					if (!defSym) { continue; }

					const defKey = `${loc.uri.fsPath}::${defSym.name}::${defSym.range.start.line}`;
					if (!visited.has(defKey)) {
						queue.push({ uri: loc.uri, symbol: defSym, depth: depth + 1 });
					}
				}
			}
		}
	}

	return {
		target: entries.find(e => e.depth === 0),
		entries,
		imports,
		budgetExhausted,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Get document symbols via the language server. Returns [] on failure. */
async function _getDocumentSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
	try {
		const result = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			'vscode.executeDocumentSymbolProvider',
			uri,
		);
		return result ?? [];
	} catch {
		return [];
	}
}

/** Recursively flatten symbols so we can search by range. */
function _flattenSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
	const flat: vscode.DocumentSymbol[] = [];
	function visit(syms: vscode.DocumentSymbol[]) {
		for (const s of syms) {
			flat.push(s);
			if (s.children?.length) { visit(s.children); }
		}
	}
	visit(symbols);
	return flat;
}

/** Function-like symbol kinds. */
const FN_KINDS = new Set([
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Method,
	vscode.SymbolKind.Constructor,
]);

/**
 * For each changed line, find the innermost function/method whose range
 * contains that line.  Returns a de-duplicated list.
 */
function _findEnclosingFunctions(
	symbols: vscode.DocumentSymbol[],
	lines: number[],
): vscode.DocumentSymbol[] {
	const flat = _flattenSymbols(symbols).filter(s => FN_KINDS.has(s.kind));
	const result: vscode.DocumentSymbol[] = [];
	const seen = new Set<string>();

	for (const lineNo of lines) {
		// Convert 1-based line number to 0-based for VS Code range comparison.
		const line0 = lineNo - 1;

		// Find all functions that contain this line.
		const candidates = flat.filter(
			s => s.range.start.line <= line0 && s.range.end.line >= line0,
		);

		if (candidates.length === 0) { continue; }

		// Pick the innermost (smallest range).
		candidates.sort(
			(a, b) => (a.range.end.line - a.range.start.line) - (b.range.end.line - b.range.start.line),
		);
		const innermost = candidates[0];

		const key = `${innermost.name}:${innermost.range.start.line}`;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(innermost);
		}
	}

	return result;
}

/** Find a symbol (function/method) at or near the given line. */
function _findSymbolAtLine(symbols: vscode.DocumentSymbol[], line: number): vscode.DocumentSymbol | undefined {
	const flat = _flattenSymbols(symbols).filter(s => FN_KINDS.has(s.kind));
	// Find the smallest enclosing function.
	const candidates = flat.filter(s => s.range.start.line <= line && s.range.end.line >= line);
	if (candidates.length === 0) { return undefined; }
	candidates.sort((a, b) => (a.range.end.line - a.range.start.line) - (b.range.end.line - b.range.start.line));
	return candidates[0];
}

/**
 * Extract distinct function-call names from a code string.
 * Matches identifiers immediately followed by `(`, excluding common builtins
 * and keywords to reduce noise.
 */
function _extractCallNames(body: string): string[] {
	const SKIP = new Set([
		'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof',
		'new', 'delete', 'void', 'throw', 'await', 'yield', 'async', 'function',
		'class', 'super', 'console', 'Math', 'Object', 'Array', 'String', 'Number',
		'Boolean', 'Promise', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
		'require', 'import', 'export', 'JSON',
	]);

	const re = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
	const names = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = re.exec(body)) !== null) {
		const name = m[1];
		if (!SKIP.has(name)) { names.add(name); }
	}
	return [...names];
}

/**
 * Find the first character position of `callName(` inside `range` of `doc`.
 * Returns undefined if not found.
 */
function _findCallPosition(
	doc: vscode.TextDocument,
	range: vscode.Range,
	callName: string,
): vscode.Position | undefined {
	const text = doc.getText(range);
	const re = new RegExp(`\\b${_escapeRegex(callName)}\\s*\\(`, 'g');
	const m = re.exec(text);
	if (!m) { return undefined; }
	// Convert offset within the range text back to a document position.
	const offset = doc.offsetAt(range.start) + m.index + callName.length - 1;
	return doc.positionAt(offset);
}

function _escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Get the definition location(s) for a position. */
async function _getDefinition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[]> {
	try {
		const result = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
			'vscode.executeDefinitionProvider',
			uri,
			position,
		);
		if (!result || result.length === 0) { return []; }
		// Normalise LocationLink → Location.
		return (result as Array<vscode.Location | vscode.LocationLink>).map(r => {
			if ('targetUri' in r) {
				return new vscode.Location(r.targetUri, r.targetRange);
			}
			return r as vscode.Location;
		});
	} catch {
		return [];
	}
}

/** Skip node_modules and pure declaration files. */
function _shouldSkipUri(uri: vscode.Uri): boolean {
	const p = uri.fsPath;
	return (
		p.includes('node_modules') ||
		p.endsWith('.d.ts') ||
		p.includes('/dist/') ||
		p.includes('/build/') ||
		p.includes('/out/')
	);
}

/**
 * Async wrapper around {@link _shouldSkipUri} that gives the monorepo resolver
 * a chance to override the decision for workspace-local packages.
 *
 * When no resolver is provided the behaviour is identical to the original
 * synchronous check — existing callers are unaffected.
 */
async function _shouldSkip(uri: vscode.Uri, options?: SmartContextOptions): Promise<boolean> {
	if (!_shouldSkipUri(uri)) { return false; }

	// URI would normally be skipped — let the resolver check for workspace packages.
	if (options?.resolver) {
		const wsRoot = options.workspaceRoot ?? path.dirname(uri.fsPath);
		const isLocal = await options.resolver.isWorkspacePath(uri.fsPath, wsRoot);
		if (isLocal) { return false; }
	}

	return true;
}

/** Extract import statements from a source file. */
function _extractImports(content: string): string[] {
	const lines = content.split('\n');
	const imports: string[] = [];
	// Collect contiguous import/require lines at the top of the file.
	for (const line of lines) {
		const trimmed = line.trim();
		if (
			trimmed.startsWith('import ') ||
			trimmed.startsWith('export { ') ||
			trimmed.startsWith('const ') && trimmed.includes('require(') ||
			trimmed.startsWith('import(')
		) {
			imports.push(trimmed);
			if (imports.length >= 20) { break; } // cap at 20 import lines
		}
	}
	return imports;
}

/** Infer a markdown language identifier from the file URI. */
function _inferLanguage(uri: vscode.Uri): string {
	const ext = path.extname(uri.fsPath).toLowerCase();
	const map: Record<string, string> = {
		'.ts': 'typescript',
		'.tsx': 'tsx',
		'.js': 'javascript',
		'.jsx': 'jsx',
		'.py': 'python',
		'.rs': 'rust',
		'.go': 'go',
		'.java': 'java',
		'.php': 'php',
		'.rb': 'ruby',
		'.cs': 'csharp',
		'.swift': 'swift',
		'.kt': 'kotlin',
		'.cpp': 'cpp',
		'.c': 'c',
	};
	return map[ext] ?? '';
}
