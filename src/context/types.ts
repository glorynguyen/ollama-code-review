/**
 * F-008: Multi-File Contextual Analysis — Types
 *
 * Shared interfaces for the context-gathering subsystem that resolves imports,
 * discovers related tests, and bundles workspace file contents alongside diffs
 * so the AI reviewer has richer context.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** User-facing settings for the context gatherer. */
export interface ContextGatheringConfig {
	/** Whether multi-file context is included in reviews. */
	enabled: boolean;
	/** Maximum number of context files to include (keeps token budget in check). */
	maxFiles: number;
	/** Include test files that correspond to changed source files. */
	includeTests: boolean;
	/** Include `.d.ts` and type-definition files for imported symbols. */
	includeTypeDefinitions: boolean;
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

/** A single import statement extracted from a source file. */
export interface ParsedImport {
	/** The raw module specifier as written in the source (e.g. `./auth`, `react`). */
	specifier: string;
	/** Whether this is a relative import (`./` or `../`). */
	isRelative: boolean;
	/** Line number (1-based) of the import statement. */
	line: number;
}

// ---------------------------------------------------------------------------
// Resolved context files
// ---------------------------------------------------------------------------

/** Why a file was included in the review context. */
export type ContextFileReason =
	| 'import'           // Directly imported by a changed file
	| 'test'             // Test file matching a changed source file
	| 'type-definition'; // Type-definition file (.d.ts) for an imported module

/** A single file resolved and read from the workspace. */
export interface ContextFile {
	/** Workspace-relative path (e.g. `src/auth.ts`). */
	relativePath: string;
	/** File content (may be truncated to stay within token budget). */
	content: string;
	/** Why this file was included. */
	reason: ContextFileReason;
	/** The changed file that triggered inclusion (workspace-relative). */
	sourceFile: string;
	/** Approximate character count (useful for token budget tracking). */
	charCount: number;
}

// ---------------------------------------------------------------------------
// Gathering result
// ---------------------------------------------------------------------------

/** The bundle returned by the context gatherer. */
export interface ContextBundle {
	/** Resolved context files (ordered by relevance). */
	files: ContextFile[];
	/** Human-readable summary for the output channel / UI. */
	summary: string;
	/** Gathering statistics. */
	stats: ContextGatheringStats;
}

/** Statistics about the gathering process. */
export interface ContextGatheringStats {
	/** Number of changed files in the diff. */
	changedFiles: number;
	/** Total imports parsed across all changed files. */
	importsFound: number;
	/** Number of context files resolved and included. */
	filesIncluded: number;
	/** Number of files skipped because they exceeded the budget or limit. */
	filesSkipped: number;
	/** Number of test files discovered. */
	testFilesFound: number;
	/** Number of type-definition files discovered. */
	typeDefFilesFound: number;
	/** Total characters of context gathered. */
	totalChars: number;
}
