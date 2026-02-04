/**
 * Diff filtering module
 * Filters out noise from git diffs (lock files, generated code, etc.)
 */

import { minimatch } from 'minimatch';

export interface DiffFilterConfig {
  /** Paths to ignore (glob patterns) */
  ignorePaths: string[];
  /** File patterns to ignore */
  ignorePatterns: string[];
  /** Maximum lines per file before warning */
  maxFileLines: number;
  /** Ignore formatting-only changes */
  ignoreFormattingOnly: boolean;
}

export interface FilterResult {
  filteredDiff: string;
  stats: {
    totalFiles: number;
    includedFiles: number;
    filteredFiles: number;
    largeFiles: string[];
    filteredPaths: string[];
  };
}

const DEFAULT_IGNORE_PATHS = [
  'node_modules/**',
  '**/node_modules/**',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.nyc_output/**',
  'vendor/**',
  '.git/**',
];

const DEFAULT_IGNORE_PATTERNS = [
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.generated.*',
  '*.d.ts.map',
  '*.bundle.js',
  '*.chunk.js',
];

export const DEFAULT_FILTER_CONFIG: DiffFilterConfig = {
  ignorePaths: DEFAULT_IGNORE_PATHS,
  ignorePatterns: DEFAULT_IGNORE_PATTERNS,
  maxFileLines: 500,
  ignoreFormattingOnly: false,
};

/**
 * Extract file path from a diff header line
 */
function extractFilePath(diffLine: string): string | null {
  // Match: diff --git a/path/to/file b/path/to/file
  const match = diffLine.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (match) {
    return match[2]; // Use the "b" (new) path
  }
  return null;
}

/**
 * Check if a file path should be ignored
 */
function shouldIgnoreFile(
  filePath: string,
  config: DiffFilterConfig
): { ignore: boolean; reason?: string } {
  // Check ignore paths
  for (const pattern of config.ignorePaths) {
    if (minimatch(filePath, pattern, { dot: true })) {
      return { ignore: true, reason: `matches path pattern: ${pattern}` };
    }
  }

  // Check ignore patterns
  const fileName = filePath.split('/').pop() || filePath;
  for (const pattern of config.ignorePatterns) {
    if (minimatch(fileName, pattern, { dot: true })) {
      return { ignore: true, reason: `matches file pattern: ${pattern}` };
    }
  }

  return { ignore: false };
}

/**
 * Count changed lines in a diff chunk
 */
function countChangedLines(diffChunk: string): number {
  const lines = diffChunk.split('\n');
  let count = 0;

  for (const line of lines) {
    // Count lines starting with + or - (but not +++ or ---)
    if ((line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
      count++;
    }
  }

  return count;
}

/**
 * Check if a diff chunk contains only whitespace changes
 */
function isFormattingOnlyChange(diffChunk: string): boolean {
  const lines = diffChunk.split('\n');

  for (const line of lines) {
    if (!line.startsWith('+') && !line.startsWith('-')) {
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }

    // Get the content without the +/- prefix
    const content = line.substring(1);

    // If there's non-whitespace content, it's not formatting-only
    if (content.trim().length > 0) {
      // Check if the change is just whitespace differences
      // This is a simplified check - you might want more sophisticated logic
      const hasNonWhitespaceChange = content.replace(/\s/g, '').length > 0;
      if (hasNonWhitespaceChange) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Filter a git diff to remove noise
 */
export function filterDiff(
  diff: string,
  config: Partial<DiffFilterConfig> = {}
): FilterResult {
  const fullConfig: DiffFilterConfig = { ...DEFAULT_FILTER_CONFIG, ...config };

  // Split diff by file boundaries
  const fileDiffs = diff.split(/(?=^diff --git)/m).filter(Boolean);

  const stats = {
    totalFiles: fileDiffs.length,
    includedFiles: 0,
    filteredFiles: 0,
    largeFiles: [] as string[],
    filteredPaths: [] as string[],
  };

  const includedDiffs: string[] = [];

  for (const fileDiff of fileDiffs) {
    const firstLine = fileDiff.split('\n')[0];
    const filePath = extractFilePath(firstLine);

    if (!filePath) {
      // Can't determine file path, include it
      includedDiffs.push(fileDiff);
      stats.includedFiles++;
      continue;
    }

    // Check if should ignore
    const { ignore, reason } = shouldIgnoreFile(filePath, fullConfig);
    if (ignore) {
      stats.filteredFiles++;
      stats.filteredPaths.push(`${filePath} (${reason})`);
      continue;
    }

    // Check for large files
    const changedLines = countChangedLines(fileDiff);
    if (changedLines > fullConfig.maxFileLines) {
      stats.largeFiles.push(`${filePath} (${changedLines} lines)`);
      // Still include but warn
    }

    // Check for formatting-only changes
    if (fullConfig.ignoreFormattingOnly && isFormattingOnlyChange(fileDiff)) {
      stats.filteredFiles++;
      stats.filteredPaths.push(`${filePath} (formatting only)`);
      continue;
    }

    includedDiffs.push(fileDiff);
    stats.includedFiles++;
  }

  return {
    filteredDiff: includedDiffs.join(''),
    stats,
  };
}

/**
 * Create a summary of the filter results
 */
export function formatFilterSummary(stats: FilterResult['stats']): string {
  const lines: string[] = [];

  lines.push(`Files: ${stats.includedFiles}/${stats.totalFiles} included`);

  if (stats.filteredFiles > 0) {
    lines.push(`Filtered out ${stats.filteredFiles} file(s)`);
  }

  if (stats.largeFiles.length > 0) {
    lines.push(`Large files (may be truncated): ${stats.largeFiles.join(', ')}`);
  }

  return lines.join('\n');
}
