/**
 * F-043 extension: Monorepo-aware workspace package resolver.
 *
 * The resolver holds a registry of {@link MonorepoStrategy} implementations and
 * provides a single entry-point — {@link isWorkspacePath} — that the smart
 * context builder uses to decide whether a file that would normally be skipped
 * (e.g. inside `node_modules` or `dist/`) is actually a local workspace package
 * and should therefore be followed during the BFS call-graph traversal.
 *
 * Symlinks are resolved via `fs.promises.realpath` so that
 * `node_modules/@myapp/shared` → `../../packages/shared/src` is handled
 * transparently regardless of the package manager.
 *
 * Package discovery is cached per workspace root and lazily initialised on the
 * first call to any public method.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MonorepoStrategy, WorkspacePackage } from './types';
import { builtInStrategies } from './strategies';

export type { MonorepoStrategy, WorkspacePackage } from './types';

// ---------------------------------------------------------------------------
// MonorepoResolver
// ---------------------------------------------------------------------------

export class MonorepoResolver {
	private readonly _strategies: MonorepoStrategy[];

	/**
	 * Cache of discovered packages, keyed by the normalised workspace root.
	 * Populated lazily on the first call to {@link getPackages}.
	 */
	private readonly _cache = new Map<string, WorkspacePackage[]>();

	/**
	 * Fast-lookup set of normalised absolute root paths for all discovered
	 * packages, keyed by workspace root.  Built alongside `_cache`.
	 */
	private readonly _rootPaths = new Map<string, Set<string>>();

	constructor(strategies?: MonorepoStrategy[]) {
		this._strategies = strategies ?? [...builtInStrategies];
	}

	// -----------------------------------------------------------------------
	// Strategy registration
	// -----------------------------------------------------------------------

	/** Append a custom strategy (e.g. Nx, Lerna, Rush). */
	registerStrategy(strategy: MonorepoStrategy): void {
		this._strategies.push(strategy);
		// Invalidate caches since a new strategy might find additional packages.
		this.clearCache();
	}

	/** Prepend a strategy so it is evaluated before built-in ones. */
	registerStrategyFirst(strategy: MonorepoStrategy): void {
		this._strategies.unshift(strategy);
		this.clearCache();
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Check whether `fsPath` belongs to a local workspace package.
	 *
	 * The check resolves symlinks so that paths like
	 * `<root>/node_modules/@myapp/shared/src/util.ts` that are symlinked to
	 * `<root>/packages/shared/src/util.ts` are correctly recognised.
	 */
	async isWorkspacePath(fsPath: string, workspaceRoot: string): Promise<boolean> {
		const roots = await this._getRootPathSet(workspaceRoot);
		if (roots.size === 0) { return false; }

		// Resolve the real path (follows symlinks).
		const realPath = await _realpath(fsPath);
		const normPath = path.normalize(realPath);

		for (const pkgRoot of roots) {
			if (normPath.startsWith(pkgRoot + path.sep) || normPath === pkgRoot) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Discover all workspace packages under `workspaceRoot`.
	 * Results are cached — call {@link clearCache} to force re-discovery.
	 */
	async getPackages(workspaceRoot: string): Promise<readonly WorkspacePackage[]> {
		const key = path.normalize(workspaceRoot);

		if (this._cache.has(key)) {
			return this._cache.get(key)!;
		}

		const packages: WorkspacePackage[] = [];
		const seenRoots = new Set<string>();

		for (const strategy of this._strategies) {
			try {
				const applies = await strategy.detect(workspaceRoot);
				if (!applies) { continue; }

				const found = await strategy.discoverPackages(workspaceRoot);
				for (const pkg of found) {
					const norm = path.normalize(pkg.rootPath);
					if (!seenRoots.has(norm)) {
						seenRoots.add(norm);
						packages.push(pkg);
					}
				}
			} catch {
				// Strategy failed — skip silently and try the next one.
			}
		}

		this._cache.set(key, packages);
		this._rootPaths.set(key, seenRoots);
		return packages;
	}

	/**
	 * Look up a workspace package by its npm package name.
	 * Returns `undefined` if no matching local package is found.
	 */
	async findPackageByName(
		packageName: string,
		workspaceRoot: string,
	): Promise<WorkspacePackage | undefined> {
		const packages = await this.getPackages(workspaceRoot);
		return packages.find(p => p.name === packageName);
	}

	/** Invalidate all cached package discovery results. */
	clearCache(): void {
		this._cache.clear();
		this._rootPaths.clear();
	}

	/** Get the list of registered strategy names (for diagnostics). */
	get strategyNames(): string[] {
		return this._strategies.map(s => s.name);
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private async _getRootPathSet(workspaceRoot: string): Promise<Set<string>> {
		const key = path.normalize(workspaceRoot);
		if (!this._rootPaths.has(key)) {
			await this.getPackages(workspaceRoot);
		}
		return this._rootPaths.get(key) ?? new Set();
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve symlinks, returning the original path on failure. */
async function _realpath(p: string): Promise<string> {
	try {
		return await fs.promises.realpath(p);
	} catch {
		return p;
	}
}
