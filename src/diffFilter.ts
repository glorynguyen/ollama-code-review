import * as vscode from 'vscode';
import { getYamlDiffFilterOverrides } from './config/promptLoader';

export interface DiffFilterConfig {
	ignorePaths: string[];
	ignorePatterns: string[];
	maxFileLines: number;
	ignoreFormattingOnly: boolean;
}

export interface FilterResult {
	filteredDiff: string;
	stats: {
		totalFiles: number;
		includedFiles: number;
		filteredFiles: string[];
		largeFiles: string[];
	};
}

const DEFAULT_IGNORE_PATHS = [
	'**/node_modules/**',
	'**/*.lock',
	'**/package-lock.json',
	'**/yarn.lock',
	'**/pnpm-lock.yaml',
	'**/dist/**',
	'**/build/**',
	'**/out/**',
	'**/.next/**',
	'**/coverage/**',
];

const DEFAULT_IGNORE_PATTERNS = [
	'*.min.js',
	'*.min.css',
	'*.map',
	'*.generated.*',
	'*.g.ts',
	'*.d.ts.map',
];

/**
 * Get diff filter configuration from VS Code settings
 */
export function getDiffFilterConfig(): DiffFilterConfig {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const filterConfig = config.get<Partial<DiffFilterConfig>>('diffFilter', {});

	return {
		ignorePaths: filterConfig.ignorePaths ?? DEFAULT_IGNORE_PATHS,
		ignorePatterns: filterConfig.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS,
		maxFileLines: filterConfig.maxFileLines ?? 500,
		ignoreFormattingOnly: filterConfig.ignoreFormattingOnly ?? false,
	};
}

/**
 * Get diff filter configuration using the full config hierarchy:
 * built-in defaults → VS Code settings → .ollama-review.yaml (highest priority).
 *
 * Use this in async contexts (e.g., runReview) to support team-shared config files.
 */
export async function getDiffFilterConfigWithYaml(outputChannel?: vscode.OutputChannel): Promise<DiffFilterConfig> {
	const settingsConfig = getDiffFilterConfig();
	const yamlOverrides = await getYamlDiffFilterOverrides(outputChannel);

	if (!yamlOverrides) {
		return settingsConfig;
	}

	return {
		ignorePaths: yamlOverrides.ignorePaths ?? settingsConfig.ignorePaths,
		ignorePatterns: yamlOverrides.ignorePatterns ?? settingsConfig.ignorePatterns,
		maxFileLines: yamlOverrides.maxFileLines ?? settingsConfig.maxFileLines,
		ignoreFormattingOnly: yamlOverrides.ignoreFormattingOnly ?? settingsConfig.ignoreFormattingOnly,
	};
}

/**
 * Check if a file path matches any of the ignore patterns
 */
function shouldIgnoreFile(filePath: string, config: DiffFilterConfig): boolean {
	const { ignorePaths, ignorePatterns } = config;

	// Check ignore paths (glob-like patterns)
	for (const pattern of ignorePaths) {
		if (matchGlobPattern(filePath, pattern)) {
			return true;
		}
	}

	// Check ignore patterns (file name patterns)
	const fileName = filePath.split('/').pop() || filePath;
	for (const pattern of ignorePatterns) {
		if (matchGlobPattern(fileName, pattern)) {
			return true;
		}
	}

	return false;
}

/**
 * Simple glob pattern matching
 */
function matchGlobPattern(text: string, pattern: string): boolean {
	// Convert glob to regex
	const regexPattern = pattern
		.replace(/\*\*/g, '{{GLOBSTAR}}')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '.')
		.replace(/{{GLOBSTAR}}/g, '.*');

	const regex = new RegExp(`^${regexPattern}$`, 'i');
	return regex.test(text);
}

/**
 * Count changed lines in a file diff (lines starting with + or -)
 */
function countChangedLines(fileDiff: string): number {
	const lines = fileDiff.split('\n');
	let count = 0;
	for (const line of lines) {
		if ((line.startsWith('+') || line.startsWith('-')) &&
			!line.startsWith('+++') && !line.startsWith('---')) {
			count++;
		}
	}
	return count;
}

/**
 * Check if diff contains only whitespace/formatting changes
 */
function isFormattingOnlyChange(fileDiff: string): boolean {
	const lines = fileDiff.split('\n');
	for (const line of lines) {
		if (line.startsWith('+') && !line.startsWith('+++')) {
			const content = line.substring(1).trim();
			if (content.length > 0) {
				// Has actual content, check if there's a corresponding removal
				const hasMatchingRemoval = lines.some(l =>
					l.startsWith('-') && !l.startsWith('---') &&
					l.substring(1).trim() === content
				);
				if (!hasMatchingRemoval) {
					return false; // Real change, not just formatting
				}
			}
		}
	}
	return true;
}

/**
 * Parse git diff into individual file diffs
 */
function parseDiffIntoFiles(diff: string): Map<string, string> {
	const files = new Map<string, string>();
	const fileDiffs = diff.split(/(?=^diff --git)/m);

	for (const fileDiff of fileDiffs) {
		if (!fileDiff.trim()) {continue;}

		// Extract file path from diff header
		const match = fileDiff.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
		if (match) {
			const filePath = match[2]; // Use the "b" path (after changes)
			files.set(filePath, fileDiff);
		}
	}

	return files;
}

/**
 * Filter a git diff to remove noise and large files
 */
export function filterDiff(diff: string, config?: DiffFilterConfig): FilterResult {
	const filterConfig = config ?? getDiffFilterConfig();
	const fileDiffs = parseDiffIntoFiles(diff);

	const filteredFiles: string[] = [];
	const largeFiles: string[] = [];
	const includedDiffs: string[] = [];

	for (const [filePath, fileDiff] of fileDiffs) {
		// Check if file should be ignored
		if (shouldIgnoreFile(filePath, filterConfig)) {
			filteredFiles.push(filePath);
			continue;
		}

		// Check for large files
		const changedLines = countChangedLines(fileDiff);
		if (changedLines > filterConfig.maxFileLines) {
			largeFiles.push(`${filePath} (${changedLines} lines)`);
			// Still include but add a warning comment
			includedDiffs.push(fileDiff);
			continue;
		}

		// Check for formatting-only changes
		if (filterConfig.ignoreFormattingOnly && isFormattingOnlyChange(fileDiff)) {
			filteredFiles.push(`${filePath} (formatting only)`);
			continue;
		}

		includedDiffs.push(fileDiff);
	}

	return {
		filteredDiff: includedDiffs.join('\n'),
		stats: {
			totalFiles: fileDiffs.size,
			includedFiles: includedDiffs.length,
			filteredFiles,
			largeFiles,
		},
	};
}

/**
 * Generate a summary message for filtered files
 */
export function getFilterSummary(stats: FilterResult['stats']): string | null {
	if (stats.filteredFiles.length === 0 && stats.largeFiles.length === 0) {
		return null;
	}

	const parts: string[] = [];

	if (stats.filteredFiles.length > 0) {
		parts.push(`Filtered ${stats.filteredFiles.length} file(s): ${stats.filteredFiles.slice(0, 3).join(', ')}${stats.filteredFiles.length > 3 ? '...' : ''}`);
	}

	if (stats.largeFiles.length > 0) {
		parts.push(`Large file(s) included: ${stats.largeFiles.join(', ')}`);
	}

	return parts.join(' | ');
}
