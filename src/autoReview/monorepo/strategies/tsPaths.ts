/**
 * Monorepo strategy: TypeScript path aliases.
 *
 * Reads `compilerOptions.paths` from `tsconfig.json` (or `tsconfig.base.json`)
 * at the workspace root.  Each alias that points to a directory within the repo
 * is treated as a synthetic workspace package so the smart-context BFS can
 * follow definitions resolved through path aliases.
 *
 * This strategy intentionally does NOT resolve `extends` chains — it only reads
 * the top-level tsconfig.  For deeply-nested configs the language server
 * already handles resolution; this strategy just informs the skip-filter.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MonorepoStrategy, WorkspacePackage } from '../types';

/** tsconfig files to try, in order. */
const TSCONFIG_CANDIDATES = [
	'tsconfig.json',
	'tsconfig.base.json',
];

export const tsPathsStrategy: MonorepoStrategy = {
	name: 'tsconfig-paths',

	async detect(rootPath: string): Promise<boolean> {
		for (const name of TSCONFIG_CANDIDATES) {
			try {
				await fs.promises.access(path.join(rootPath, name));
				return true;
			} catch { /* try next */ }
		}
		return false;
	},

	async discoverPackages(rootPath: string): Promise<WorkspacePackage[]> {
		// Find the first tsconfig that exists.
		let raw: string | undefined;
		for (const name of TSCONFIG_CANDIDATES) {
			try {
				raw = await fs.promises.readFile(path.join(rootPath, name), 'utf-8');
				break;
			} catch { /* try next */ }
		}
		if (!raw) { return []; }

		const config = parseJsonc(raw);
		const paths: Record<string, string[]> | undefined = config?.compilerOptions?.paths;
		if (!paths) { return []; }

		const baseUrl = config?.compilerOptions?.baseUrl ?? '.';
		const resolvedBase = path.resolve(rootPath, baseUrl);

		const packages: WorkspacePackage[] = [];
		const seen = new Set<string>();

		for (const [alias, targets] of Object.entries(paths)) {
			if (!targets || targets.length === 0) { continue; }

			// Use the first target to determine the package root.
			const target = targets[0];
			// Strip trailing wildcard (e.g. `./src/*` → `./src`).
			const cleanTarget = target.replace(/\/?\*$/, '');
			const absTarget = path.resolve(resolvedBase, cleanTarget);

			// Walk up to find a directory with package.json, or use the target directly.
			const pkgRoot = await findPackageRoot(absTarget, rootPath);
			if (!pkgRoot || seen.has(pkgRoot)) { continue; }
			seen.add(pkgRoot);

			// Read package.json for a proper name; fall back to the alias itself.
			let name = alias.replace(/\/?\*$/, '');
			try {
				const pkgJson = JSON.parse(
					await fs.promises.readFile(path.join(pkgRoot, 'package.json'), 'utf-8'),
				);
				if (pkgJson.name) { name = pkgJson.name; }
			} catch { /* use alias */ }

			const wp: WorkspacePackage = { name, rootPath: pkgRoot };

			// If the target itself looks like a src directory, record it.
			const targetBase = path.basename(absTarget);
			if (['src', 'lib', 'source'].includes(targetBase)) {
				wp.srcPath = absTarget;
			}

			packages.push(wp);
		}

		return packages;
	},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip line comments, block comments, and trailing commas from JSONC. */
function parseJsonc(text: string): Record<string, any> | undefined {
	try {
		const stripped = text
			.replace(/\/\/.*$/gm, '')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/,\s*([}\]])/g, '$1');
		return JSON.parse(stripped);
	} catch {
		return undefined;
	}
}

/**
 * Walk up from `startPath` towards `stopAt` looking for a `package.json`.
 * Returns the directory containing the package.json, or `undefined`.
 */
async function findPackageRoot(startPath: string, stopAt: string): Promise<string | undefined> {
	let dir = startPath;

	// Normalise: if startPath is a file, start from its parent.
	try {
		const stat = await fs.promises.stat(dir);
		if (!stat.isDirectory()) { dir = path.dirname(dir); }
	} catch {
		dir = path.dirname(dir);
	}

	const stop = path.resolve(stopAt);
	while (dir.startsWith(stop)) {
		try {
			await fs.promises.access(path.join(dir, 'package.json'));
			// Don't return the workspace root itself — that's the monorepo root.
			if (dir === stop) { return undefined; }
			return dir;
		} catch { /* keep walking */ }
		const parent = path.dirname(dir);
		if (parent === dir) { break; }
		dir = parent;
	}

	return undefined;
}
