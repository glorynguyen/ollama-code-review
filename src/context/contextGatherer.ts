/**
 * F-008: Multi-File Contextual Analysis — Context Gatherer
 *
 * Main orchestrator that combines import parsing, file resolution, test
 * discovery, and type-definition lookup to build a {@link ContextBundle}
 * for use in AI code reviews.
 *
 * Usage:
 *   const bundle = await gatherContext(diff, config, outputChannel);
 *   // bundle.files   → resolved context files with content
 *   // bundle.summary → human-readable log line
 *   // bundle.stats   → numeric stats for the UI
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
	ContextBundle,
	ContextFile,
	ContextGatheringConfig,
	ContextGatheringStats,
} from './types';
import { parseImports, extractChangedFiles } from './importParser';
import { resolveImport, readFileContent, toRelativePath } from './fileResolver';
import { findTestFiles } from './testDiscovery';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default config when the user hasn't changed any settings. */
export const DEFAULT_CONTEXT_CONFIG: ContextGatheringConfig = {
	enabled: true,
	maxFiles: 10,
	includeTests: true,
	includeTypeDefinitions: true,
};

/**
 * Character budget per file (≈ 2 000 tokens at ~4 chars/token).
 * Keeps total context from blowing up the prompt.
 */
const PER_FILE_CHAR_LIMIT = 8_000;

/**
 * Overall character budget for all context files combined
 * (≈ 8 000 tokens at ~4 chars/token).
 */
const TOTAL_CHAR_BUDGET = 32_000;

// ---------------------------------------------------------------------------
// Configuration reader
// ---------------------------------------------------------------------------

/** Read context-gathering settings from VS Code configuration. */
export function getContextGatheringConfig(): ContextGatheringConfig {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const section = config.get<Partial<ContextGatheringConfig>>('contextGathering', {});

	return {
		enabled: section.enabled ?? DEFAULT_CONTEXT_CONFIG.enabled,
		maxFiles: section.maxFiles ?? DEFAULT_CONTEXT_CONFIG.maxFiles,
		includeTests: section.includeTests ?? DEFAULT_CONTEXT_CONFIG.includeTests,
		includeTypeDefinitions: section.includeTypeDefinitions ?? DEFAULT_CONTEXT_CONFIG.includeTypeDefinitions,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Gather multi-file context for a diff.
 *
 * Steps:
 *   1. Extract changed file paths from the diff.
 *   2. For each changed file, read it from the workspace and parse imports.
 *   3. Resolve relative imports to real workspace files and read their content.
 *   4. Discover related test files (optional).
 *   5. Discover type-definition files (optional).
 *   6. Deduplicate and trim to the configured limits / char budget.
 *
 * @param diff           - Unified diff string.
 * @param config         - Context-gathering configuration.
 * @param outputChannel  - Optional output channel for logging.
 * @returns A {@link ContextBundle} ready for prompt injection.
 */
export async function gatherContext(
	diff: string,
	config: ContextGatheringConfig,
	outputChannel?: vscode.OutputChannel,
): Promise<ContextBundle> {
	const stats: ContextGatheringStats = {
		changedFiles: 0,
		importsFound: 0,
		filesIncluded: 0,
		filesSkipped: 0,
		testFilesFound: 0,
		typeDefFilesFound: 0,
		totalChars: 0,
	};

	const emptyBundle: ContextBundle = { files: [], summary: 'No context gathered.', stats };

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return emptyBundle;
	}

	const workspaceRoot = workspaceFolders[0].uri;
	const changedPaths = extractChangedFiles(diff);
	stats.changedFiles = changedPaths.length;

	if (changedPaths.length === 0) {
		return emptyBundle;
	}

	outputChannel?.appendLine(`\n--- Context Gathering (F-008) ---`);
	outputChannel?.appendLine(`Changed files: ${changedPaths.join(', ')}`);

	// Track included files to avoid duplicates
	const includedPaths = new Set<string>(changedPaths); // changed files themselves shouldn't be included
	const contextFiles: ContextFile[] = [];
	let totalChars = 0;

	// Helper: try to add a context file
	const tryAdd = async (
		uri: vscode.Uri,
		reason: ContextFile['reason'],
		sourceFile: string,
	): Promise<boolean> => {
		const relPath = toRelativePath(uri, workspaceRoot);
		if (includedPaths.has(relPath)) {
			return false;
		}
		if (contextFiles.length >= config.maxFiles) {
			stats.filesSkipped++;
			return false;
		}
		if (totalChars >= TOTAL_CHAR_BUDGET) {
			stats.filesSkipped++;
			return false;
		}

		const remaining = TOTAL_CHAR_BUDGET - totalChars;
		const charLimit = Math.min(PER_FILE_CHAR_LIMIT, remaining);
		const content = await readFileContent(uri, charLimit);
		if (!content) {
			return false;
		}

		includedPaths.add(relPath);
		const charCount = content.length;
		totalChars += charCount;

		contextFiles.push({ relativePath: relPath, content, reason, sourceFile, charCount });
		return true;
	};

	// -----------------------------------------------------------------------
	// Phase 1: Resolve imports from changed files
	// -----------------------------------------------------------------------
	for (const changedFile of changedPaths) {
		const fileUri = vscode.Uri.joinPath(workspaceRoot, changedFile);
		const fileContent = await readFileContent(fileUri);
		if (!fileContent) {
			continue;
		}

		const imports = parseImports(fileContent);
		stats.importsFound += imports.length;

		for (const imp of imports) {
			if (!imp.isRelative) {
				continue; // Skip node_modules / bare specifiers
			}
			if (contextFiles.length >= config.maxFiles || totalChars >= TOTAL_CHAR_BUDGET) {
				break;
			}

			const resolved = await resolveImport(imp.specifier, changedFile, workspaceRoot);
			if (resolved) {
				await tryAdd(resolved, 'import', changedFile);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Phase 2: Discover test files
	// -----------------------------------------------------------------------
	if (config.includeTests) {
		for (const changedFile of changedPaths) {
			if (contextFiles.length >= config.maxFiles || totalChars >= TOTAL_CHAR_BUDGET) {
				break;
			}

			const testUris = await findTestFiles(changedFile, workspaceRoot);
			for (const testUri of testUris) {
				if (contextFiles.length >= config.maxFiles || totalChars >= TOTAL_CHAR_BUDGET) {
					break;
				}
				const added = await tryAdd(testUri, 'test', changedFile);
				if (added) {
					stats.testFilesFound++;
				}
			}
		}
	}

	// -----------------------------------------------------------------------
	// Phase 3: Discover type-definition files (.d.ts)
	// -----------------------------------------------------------------------
	if (config.includeTypeDefinitions) {
		for (const changedFile of changedPaths) {
			if (contextFiles.length >= config.maxFiles || totalChars >= TOTAL_CHAR_BUDGET) {
				break;
			}

			const ext = path.posix.extname(changedFile);
			if (ext !== '.ts' && ext !== '.tsx') {
				continue;
			}

			const baseName = path.posix.basename(changedFile, ext);
			const dir = path.posix.dirname(changedFile);

			// Check for co-located .d.ts
			const dtsPath = path.posix.join(dir, `${baseName}.d.ts`);
			const dtsUri = vscode.Uri.joinPath(workspaceRoot, dtsPath);
			const added = await tryAdd(dtsUri, 'type-definition', changedFile);
			if (added) {
				stats.typeDefFilesFound++;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Build result
	// -----------------------------------------------------------------------
	stats.filesIncluded = contextFiles.length;
	stats.totalChars = totalChars;

	const summary = buildSummary(stats);
	outputChannel?.appendLine(summary);

	return { files: contextFiles, summary, stats };
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/**
 * Format the context bundle into a string suitable for injection into the
 * review prompt.
 *
 * @param bundle - The gathered context bundle.
 * @returns A formatted string, or empty string if no context files.
 */
export function formatContextForPrompt(bundle: ContextBundle): string {
	if (bundle.files.length === 0) {
		return '';
	}

	const parts = bundle.files.map((file, i) => {
		const reasonLabel = {
			'import': 'Imported by',
			'test': 'Test for',
			'type-definition': 'Type definitions for',
		}[file.reason];

		return [
			`### Context File ${i + 1}: ${file.relativePath}`,
			`<!-- ${reasonLabel} ${file.sourceFile} -->`,
			'```',
			file.content,
			'```',
		].join('\n');
	});

	return [
		`\n**Related Files** (${bundle.files.length} file(s) for additional context):`,
		...parts,
	].join('\n\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSummary(stats: ContextGatheringStats): string {
	const parts: string[] = [];

	parts.push(`Context: ${stats.filesIncluded} file(s) gathered`);

	if (stats.importsFound > 0) {
		parts.push(`${stats.importsFound} imports parsed`);
	}
	if (stats.testFilesFound > 0) {
		parts.push(`${stats.testFilesFound} test file(s)`);
	}
	if (stats.typeDefFilesFound > 0) {
		parts.push(`${stats.typeDefFilesFound} type def(s)`);
	}
	if (stats.filesSkipped > 0) {
		parts.push(`${stats.filesSkipped} skipped (limit/budget)`);
	}

	parts.push(`${(stats.totalChars / 1024).toFixed(1)}KB total`);

	return parts.join(' | ');
}
