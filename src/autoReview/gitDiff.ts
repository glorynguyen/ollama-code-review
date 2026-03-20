/**
 * F-043 helper: git diff integration.
 *
 * Runs `git diff HEAD -- <file>` so the diff is always relative to the last
 * commit, giving accurate unstaged-change detection regardless of how many
 * times the file has been saved since the last review.
 *
 * Result types:
 *   { kind: 'diff',        diff: string }  — staged/unstaged changes vs HEAD
 *   { kind: 'untracked',   content: string } — file not yet known to git
 *   { kind: 'unchanged' }                  — file exists and has no diff vs HEAD
 *   { kind: 'error',       message: string } — git not available / not a repo
 */

import { execFile } from 'child_process';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type GitDiffResult =
	| { kind: 'diff'; diff: string }
	| { kind: 'untracked'; content: string }
	| { kind: 'unchanged' }
	| { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the git diff for a single file relative to HEAD.
 *
 * @param absoluteFilePath  Absolute path to the saved file.
 * @param fileContent       Current in-memory content (used for untracked files).
 * @param cwd               Working directory for git (defaults to file's directory).
 */
export async function getGitDiff(
	absoluteFilePath: string,
	fileContent: string,
	cwd?: string,
): Promise<GitDiffResult> {
	const workDir = cwd ?? path.dirname(absoluteFilePath);

	// 1. Check if the file is tracked by git.
	const lsFilesResult = await _execGit(
		['ls-files', '--error-unmatch', '--', absoluteFilePath],
		workDir,
	);

	if (lsFilesResult.exitCode === 1) {
		// File is untracked — send full content as the "diff".
		return { kind: 'untracked', content: fileContent };
	}

	if (lsFilesResult.exitCode !== 0) {
		// Not a git repo or git not available.
		return { kind: 'error', message: lsFilesResult.stderr || 'git ls-files failed' };
	}

	// 2. Get the diff relative to HEAD (includes both staged and unstaged changes).
	const diffResult = await _execGit(
		['diff', 'HEAD', '--', absoluteFilePath],
		workDir,
	);

	if (diffResult.exitCode !== 0) {
		return { kind: 'error', message: diffResult.stderr || 'git diff failed' };
	}

	const diff = diffResult.stdout.trim();

	if (!diff) {
		// File is tracked and identical to HEAD — nothing to review.
		return { kind: 'unchanged' };
	}

	return { kind: 'diff', diff };
}

/**
 * Extract which line numbers (1-based, in the NEW file) were added or modified
 * by parsing the `+` lines of a unified diff.
 *
 * Returns an array of line numbers, sorted ascending.
 */
export function parseChangedLineNumbers(diff: string): number[] {
	const lineNumbers: number[] = [];
	// Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
	const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
	let currentLine = 0;

	for (const line of diff.split('\n')) {
		const hunkMatch = hunkRe.exec(line);
		if (hunkMatch) {
			currentLine = parseInt(hunkMatch[1], 10);
			continue;
		}

		if (line.startsWith('+++') || line.startsWith('---')) {
			// Diff header lines — skip.
			continue;
		}

		if (line.startsWith('+')) {
			lineNumbers.push(currentLine);
			currentLine++;
		} else if (line.startsWith('-')) {
			// Deleted line — doesn't advance the new-file counter.
		} else if (line.startsWith(' ') || line === '') {
			// Context line.
			currentLine++;
		}
	}

	return [...new Set(lineNumbers)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Internal helper: promisified execFile wrapper
// ---------------------------------------------------------------------------

interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function _execGit(args: string[], cwd: string): Promise<ExecResult> {
	return new Promise(resolve => {
		execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
			resolve({
				exitCode: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
				stdout: stdout ?? '',
				stderr: stderr ?? '',
			});
		});
	});
}
