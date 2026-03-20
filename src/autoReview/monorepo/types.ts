/**
 * F-043 extension: Monorepo workspace package resolution — shared types.
 *
 * Defines the strategy interface so new monorepo layouts (Nx, Lerna, Rush, …)
 * can be added without touching existing code.
 */

// ---------------------------------------------------------------------------
// Workspace package descriptor
// ---------------------------------------------------------------------------

/** A single local package discovered inside a monorepo. */
export interface WorkspacePackage {
	/** Package name from `package.json` (e.g. `@myapp/shared-utils`). */
	name: string;
	/** Absolute path to the package root directory. */
	rootPath: string;
	/** Absolute path to the source directory when detected (e.g. `rootPath/src`). */
	srcPath?: string;
}

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

/**
 * A pluggable strategy that can detect and discover workspace packages for a
 * specific monorepo layout.
 *
 * Implementors only need two methods:
 *   1. `detect`            — check whether this strategy applies (fast, file-existence check).
 *   2. `discoverPackages`  — enumerate all local packages and their root paths.
 */
export interface MonorepoStrategy {
	/** Human-readable strategy name (e.g. `'npm-workspaces'`). */
	readonly name: string;

	/**
	 * Return `true` if this strategy applies to the given workspace root.
	 * Implementations should only check for marker files — not do heavy I/O.
	 */
	detect(rootPath: string): Promise<boolean>;

	/**
	 * Discover all local workspace packages under `rootPath`.
	 * Only called when {@link detect} returned `true`.
	 */
	discoverPackages(rootPath: string): Promise<WorkspacePackage[]>;
}
