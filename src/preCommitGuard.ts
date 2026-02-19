/**
 * F-014: Pre-Commit Guard
 *
 * Provides a pre-commit review workflow that runs an AI review on staged
 * changes before committing. When enabled, a git pre-commit hook blocks
 * direct commits and directs users to the "Review & Commit" command.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Severity, parseReviewIntoFindings, ReviewFinding } from './github/commentMapper';

/** Severity levels ordered from most to least severe. */
const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** The marker file written temporarily to bypass the hook during "Review & Commit". */
const BYPASS_FILENAME = '.ollama-review-bypass';

/** Pre-commit hook script content. */
const HOOK_SCRIPT = `#!/bin/sh
# Ollama Code Review — Pre-Commit Guard (F-014)
# Installed by the Ollama Code Review VS Code extension.
# This hook blocks direct commits; use "Ollama: Review & Commit" from VS Code.
# To bypass: git commit --no-verify

BYPASS_FILE=".git/${BYPASS_FILENAME}"
if [ -f "$BYPASS_FILE" ]; then
  rm -f "$BYPASS_FILE"
  exit 0
fi

echo ""
echo "=========================================="
echo "  Ollama Code Review — Pre-Commit Guard"
echo "=========================================="
echo ""
echo "Direct commits are blocked while the pre-commit guard is active."
echo ""
echo "Options:"
echo "  1. Use the VS Code command: Ollama: Review & Commit"
echo "  2. Bypass this hook: git commit --no-verify"
echo ""
exit 1
`;

export interface PreCommitGuardConfig {
	severityThreshold: Severity;
	timeout: number;
}

export interface SeverityAssessment {
	pass: boolean;
	threshold: Severity;
	findings: ReviewFinding[];
	counts: Record<Severity, number>;
	blockingFindings: ReviewFinding[];
}

/**
 * Read the pre-commit guard configuration from VS Code settings.
 */
export function getPreCommitGuardConfig(): PreCommitGuardConfig {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	return {
		severityThreshold: config.get<Severity>('preCommitGuard.severityThreshold', 'high'),
		timeout: config.get<number>('preCommitGuard.timeout', 60),
	};
}

/**
 * Check whether the pre-commit hook is currently installed for a given repo.
 */
export function isHookInstalled(repoPath: string): boolean {
	const hookPath = path.join(repoPath, '.git', 'hooks', 'pre-commit');
	try {
		const content = fs.readFileSync(hookPath, 'utf-8');
		return content.includes('Ollama Code Review');
	} catch {
		return false;
	}
}

/**
 * Install the pre-commit hook into the repository's .git/hooks directory.
 * Returns true on success, false if there is an existing non-Ollama hook.
 */
export function installHook(repoPath: string): { success: boolean; message: string } {
	const hooksDir = path.join(repoPath, '.git', 'hooks');
	const hookPath = path.join(hooksDir, 'pre-commit');

	// Ensure .git/hooks exists
	if (!fs.existsSync(hooksDir)) {
		fs.mkdirSync(hooksDir, { recursive: true });
	}

	// Check for existing hook that isn't ours
	if (fs.existsSync(hookPath)) {
		const existing = fs.readFileSync(hookPath, 'utf-8');
		if (!existing.includes('Ollama Code Review')) {
			return {
				success: false,
				message: 'An existing pre-commit hook was found. The Ollama pre-commit guard was not installed to avoid overwriting it. You can rename the existing hook and try again.'
			};
		}
	}

	fs.writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 });
	return { success: true, message: 'Pre-commit guard installed.' };
}

/**
 * Remove the Ollama pre-commit hook from the repository.
 */
export function uninstallHook(repoPath: string): { success: boolean; message: string } {
	const hookPath = path.join(repoPath, '.git', 'hooks', 'pre-commit');

	if (!fs.existsSync(hookPath)) {
		return { success: true, message: 'No pre-commit hook to remove.' };
	}

	const content = fs.readFileSync(hookPath, 'utf-8');
	if (!content.includes('Ollama Code Review')) {
		return {
			success: false,
			message: 'The existing pre-commit hook was not installed by Ollama Code Review. Not removing it.'
		};
	}

	fs.unlinkSync(hookPath);
	return { success: true, message: 'Pre-commit guard removed.' };
}

/**
 * Create a temporary bypass file so the pre-commit hook allows the next commit.
 */
export function createBypassFile(repoPath: string): void {
	const bypassPath = path.join(repoPath, '.git', BYPASS_FILENAME);
	fs.writeFileSync(bypassPath, `bypass-${Date.now()}`, 'utf-8');
}

/**
 * Remove the bypass file (cleanup after commit).
 */
export function removeBypassFile(repoPath: string): void {
	const bypassPath = path.join(repoPath, '.git', BYPASS_FILENAME);
	try {
		fs.unlinkSync(bypassPath);
	} catch {
		// Already removed or never created
	}
}

/**
 * Assess the severity of an AI review against the configured threshold.
 *
 * Findings at or above the threshold severity level cause a block.
 * For example, threshold "high" blocks on "critical" and "high" findings.
 */
export function assessSeverity(reviewText: string, diff: string, threshold: Severity): SeverityAssessment {
	const findings = parseReviewIntoFindings(reviewText, diff);

	const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
	for (const f of findings) {
		counts[f.severity]++;
	}

	// Check for the "no issues" response
	if (reviewText.toLowerCase().includes('found no significant issues')) {
		return { pass: true, threshold, findings, counts, blockingFindings: [] };
	}

	const thresholdIndex = SEVERITY_ORDER.indexOf(threshold);
	const blockingSeverities = SEVERITY_ORDER.slice(0, thresholdIndex + 1);

	const blockingFindings = findings.filter(f => blockingSeverities.includes(f.severity));

	return {
		pass: blockingFindings.length === 0,
		threshold,
		findings,
		counts,
		blockingFindings
	};
}

/**
 * Format a severity assessment into a human-readable summary for the modal dialog.
 */
export function formatAssessmentSummary(assessment: SeverityAssessment): string {
	const severityEmoji: Record<Severity, string> = {
		critical: '🔴',
		high: '🟠',
		medium: '🟡',
		low: '🔵',
		info: 'ℹ️'
	};

	const lines: string[] = [];

	if (assessment.pass) {
		lines.push('No findings at or above the configured severity threshold.');
	} else {
		lines.push(`Found ${assessment.blockingFindings.length} finding(s) at or above "${assessment.threshold}" severity:`);
		lines.push('');
		for (const sev of SEVERITY_ORDER) {
			if (assessment.counts[sev] > 0) {
				lines.push(`  ${severityEmoji[sev]} ${sev}: ${assessment.counts[sev]}`);
			}
		}
	}

	return lines.join('\n');
}
