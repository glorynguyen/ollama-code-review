/**
 * F-008: Multi-File Contextual Analysis — File Resolver
 *
 * Resolves relative import specifiers to actual workspace files, handling
 * TypeScript/JavaScript extension resolution (`.ts`, `.tsx`, `.js`, `.jsx`,
 * `/index.*`). Also provides utilities for reading file content with a
 * character budget.
 */

import * as vscode from 'vscode';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Extension resolution order (mirrors TypeScript/Node module resolution)
// ---------------------------------------------------------------------------

/** Extensions tried when the import specifier omits one. */
const RESOLVE_EXTENSIONS = [
	'.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs',
];

/** Index files tried when the specifier points to a directory. */
const INDEX_FILES = RESOLVE_EXTENSIONS.map(ext => `index${ext}`);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a relative import specifier to an actual workspace file URI.
 *
 * Resolution order for `./foo`:
 *   1. `./foo` (exact match, e.g. JSON or other extension-ful imports)
 *   2. `./foo.ts`, `./foo.tsx`, `./foo.js`, … (appended extensions)
 *   3. `./foo/index.ts`, `./foo/index.tsx`, … (directory index files)
 *
 * @param specifier  - The import specifier (e.g. `./auth`, `../utils`).
 * @param sourceFile - Workspace-relative path of the importing file.
 * @param workspaceRoot - URI of the workspace root folder.
 * @returns The resolved file URI, or `undefined` if not found.
 */
export async function resolveImport(
	specifier: string,
	sourceFile: string,
	workspaceRoot: vscode.Uri,
): Promise<vscode.Uri | undefined> {
	const sourceDir = path.posix.dirname(sourceFile);
	const resolved = path.posix.normalize(path.posix.join(sourceDir, specifier));

	// 1. Try exact match
	const exactUri = vscode.Uri.joinPath(workspaceRoot, resolved);
	if (await fileExists(exactUri)) {
		return exactUri;
	}

	// 2. Try appending extensions
	for (const ext of RESOLVE_EXTENSIONS) {
		const candidate = vscode.Uri.joinPath(workspaceRoot, resolved + ext);
		if (await fileExists(candidate)) {
			return candidate;
		}
	}

	// 3. Try directory index files
	for (const indexFile of INDEX_FILES) {
		const candidate = vscode.Uri.joinPath(workspaceRoot, resolved, indexFile);
		if (await fileExists(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

/**
 * Read a workspace file and return its content, respecting a character budget.
 *
 * @param uri        - File URI to read.
 * @param maxChars   - Maximum characters to return (0 = unlimited).
 * @returns The file content (possibly truncated), or `undefined` on error.
 */
export async function readFileContent(
	uri: vscode.Uri,
	maxChars: number = 0,
): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		let content = Buffer.from(bytes).toString('utf-8');
		if (maxChars > 0 && content.length > maxChars) {
			content = content.slice(0, maxChars) + '\n// … truncated for review context';
		}
		return content;
	} catch {
		return undefined;
	}
}

/**
 * Convert a file URI to a workspace-relative path.
 */
export function toRelativePath(uri: vscode.Uri, workspaceRoot: vscode.Uri): string {
	const rootStr = workspaceRoot.path.endsWith('/')
		? workspaceRoot.path
		: workspaceRoot.path + '/';
	if (uri.path.startsWith(rootStr)) {
		return uri.path.slice(rootStr.length);
	}
	return uri.path;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type === vscode.FileType.File;
	} catch {
		return false;
	}
}
