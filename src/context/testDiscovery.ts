/**
 * F-008: Multi-File Contextual Analysis — Test Discovery
 *
 * Discovers test files that correspond to changed source files by searching
 * common naming conventions:
 *   - Co-located:  `foo.test.ts`, `foo.spec.ts`
 *   - Mirror dirs: `__tests__/foo.ts`, `test/foo.ts`, `tests/foo.ts`
 *
 * The discovery is intentionally lightweight — it checks a fixed set of
 * candidate paths rather than scanning the entire workspace tree.
 */

import * as vscode from 'vscode';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Naming conventions
// ---------------------------------------------------------------------------

/** Suffixes inserted before the extension to form co-located test files. */
const TEST_SUFFIXES = ['.test', '.spec'];

/** Sibling directories that commonly hold mirrored test files. */
const TEST_DIRS = ['__tests__', 'test', 'tests'];

/** Source extensions that have corresponding test files. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find test file(s) for a given source file.
 *
 * @param sourceFile     - Workspace-relative path of the source file (e.g. `src/auth.ts`).
 * @param workspaceRoot  - URI of the workspace root.
 * @returns Array of discovered test file URIs (may be empty).
 */
export async function findTestFiles(
	sourceFile: string,
	workspaceRoot: vscode.Uri,
): Promise<vscode.Uri[]> {
	const ext = path.posix.extname(sourceFile);
	if (!SOURCE_EXTENSIONS.includes(ext)) {
		return [];
	}

	// Skip files that are already test files
	const baseName = path.posix.basename(sourceFile, ext);
	if (baseName.endsWith('.test') || baseName.endsWith('.spec')) {
		return [];
	}

	const dir = path.posix.dirname(sourceFile);
	const candidates: string[] = [];

	// 1. Co-located: same dir, e.g. `src/auth.test.ts`
	for (const suffix of TEST_SUFFIXES) {
		candidates.push(path.posix.join(dir, `${baseName}${suffix}${ext}`));
	}

	// 2. Mirror dirs: `src/__tests__/auth.ts`, `src/__tests__/auth.test.ts`, etc.
	for (const testDir of TEST_DIRS) {
		candidates.push(path.posix.join(dir, testDir, `${baseName}${ext}`));
		for (const suffix of TEST_SUFFIXES) {
			candidates.push(path.posix.join(dir, testDir, `${baseName}${suffix}${ext}`));
		}
	}

	// 3. Root-level test dirs mirroring source structure:
	//    e.g. `src/auth.ts` → `test/src/auth.ts`, `tests/auth.test.ts`
	const parts = dir.split('/');
	if (parts.length > 0 && parts[0] === 'src') {
		const subPath = parts.slice(1).join('/');
		for (const testDir of TEST_DIRS) {
			const base = subPath ? path.posix.join(testDir, subPath) : testDir;
			candidates.push(path.posix.join(base, `${baseName}${ext}`));
			for (const suffix of TEST_SUFFIXES) {
				candidates.push(path.posix.join(base, `${baseName}${suffix}${ext}`));
			}
		}
	}

	// Check which candidates actually exist
	const found: vscode.Uri[] = [];
	for (const candidate of candidates) {
		const uri = vscode.Uri.joinPath(workspaceRoot, candidate);
		if (await fileExists(uri)) {
			found.push(uri);
		}
	}

	return found;
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
