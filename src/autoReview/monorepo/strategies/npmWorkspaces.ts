/**
 * Monorepo strategy: npm / yarn workspaces.
 *
 * Detects workspaces defined in the root `package.json` under the `workspaces`
 * key (both the array and the `{ packages: [...] }` object forms).
 *
 * Glob patterns like `packages/*` are expanded by listing directories.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MonorepoStrategy, WorkspacePackage } from '../types';

export const npmWorkspacesStrategy: MonorepoStrategy = {
	name: 'npm-workspaces',

	async detect(rootPath: string): Promise<boolean> {
		try {
			const raw = await fs.promises.readFile(path.join(rootPath, 'package.json'), 'utf-8');
			const pkg = JSON.parse(raw);
			return Array.isArray(pkg.workspaces) || Array.isArray(pkg.workspaces?.packages);
		} catch {
			return false;
		}
	},

	async discoverPackages(rootPath: string): Promise<WorkspacePackage[]> {
		const raw = await fs.promises.readFile(path.join(rootPath, 'package.json'), 'utf-8');
		const pkg = JSON.parse(raw);

		// Normalise both forms: string[] and { packages: string[] }.
		const globs: string[] = Array.isArray(pkg.workspaces)
			? pkg.workspaces
			: Array.isArray(pkg.workspaces?.packages)
				? pkg.workspaces.packages
				: [];

		const dirs = await expandGlobs(rootPath, globs);
		return readPackages(dirs);
	},
};

// ---------------------------------------------------------------------------
// Shared helpers (also used by pnpm strategy)
// ---------------------------------------------------------------------------

/**
 * Expand simple workspace glob patterns into absolute directory paths.
 *
 * Supports:
 *   - `packages/*`       — list direct children of `packages/`
 *   - `packages/**`      — list direct children (same behaviour for discovery)
 *   - `apps/my-app`      — literal directory
 */
export async function expandGlobs(rootPath: string, patterns: string[]): Promise<string[]> {
	const dirs: string[] = [];

	for (const pattern of patterns) {
		if (pattern.endsWith('/*') || pattern.endsWith('/**')) {
			const base = pattern.replace(/\/\*{1,2}$/, '');
			const basePath = path.join(rootPath, base);
			try {
				const entries = await fs.promises.readdir(basePath, { withFileTypes: true });
				for (const entry of entries) {
					if (entry.isDirectory() || entry.isSymbolicLink()) {
						dirs.push(path.join(basePath, entry.name));
					}
				}
			} catch {
				// Base directory doesn't exist — skip silently.
			}
		} else {
			// Literal directory path.
			const dirPath = path.join(rootPath, pattern);
			try {
				const stat = await fs.promises.stat(dirPath);
				if (stat.isDirectory()) { dirs.push(dirPath); }
			} catch {
				// Doesn't exist — skip.
			}
		}
	}

	return dirs;
}

/**
 * Read `package.json` from each directory and build WorkspacePackage entries.
 * Directories without a `package.json` or without a `name` field are skipped.
 */
export async function readPackages(dirs: string[]): Promise<WorkspacePackage[]> {
	const packages: WorkspacePackage[] = [];

	for (const dir of dirs) {
		try {
			const pkgPath = path.join(dir, 'package.json');
			const raw = await fs.promises.readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(raw);
			if (!pkg.name) { continue; }

			const wp: WorkspacePackage = { name: pkg.name, rootPath: dir };

			// Detect common source directories.
			for (const candidate of ['src', 'lib', 'source']) {
				const candidatePath = path.join(dir, candidate);
				try {
					const stat = await fs.promises.stat(candidatePath);
					if (stat.isDirectory()) { wp.srcPath = candidatePath; break; }
				} catch { /* doesn't exist */ }
			}

			packages.push(wp);
		} catch {
			// No valid package.json — skip.
		}
	}

	return packages;
}
