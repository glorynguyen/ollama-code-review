/**
 * F-050: Code Health Regression Guard — Tracker
 *
 * Aggregates per-file health scores from the ReviewScoreStore history,
 * detects regressions, and surfaces hotspots (files with lowest health).
 */

import * as vscode from 'vscode';
import type { ReviewScore } from '../reviewScore';
import { ReviewScoreStore, computeScore } from '../reviewScore';
import type { FindingCounts } from '../notifications';
import type {
	CodeHealthConfig,
	FileHealthEntry,
	FileHealthSummary,
	FileRegression,
	RegressionResult,
} from './types';

// ─── Configuration ───────────────────────────────────────────────────────────

export function getCodeHealthConfig(): CodeHealthConfig {
	const cfg = vscode.workspace.getConfiguration('ollama-code-review.codeHealth');
	return {
		enabled: cfg.get<boolean>('enabled', true),
		regressionThreshold: Math.max(1, cfg.get<number>('regressionThreshold', 10)),
		blockOnRegression: cfg.get<boolean>('blockOnRegression', false),
		hotspotCount: Math.max(1, cfg.get<number>('hotspotCount', 15)),
	};
}

// ─── Per-file health aggregation ─────────────────────────────────────────────

/**
 * Build a map of file path → ordered list of health entries (most recent first)
 * from the full review score history.
 */
export function buildFileHealthMap(scores: readonly ReviewScore[]): Map<string, FileHealthEntry[]> {
	const map = new Map<string, FileHealthEntry[]>();

	for (const score of scores) {
		const files = score.filesReviewed;
		if (!files || files.length === 0) { continue; }

		for (const filePath of files) {
			const normalized = normalizePath(filePath);
			if (!normalized) { continue; }

			const entry: FileHealthEntry = {
				filePath: normalized,
				score: score.score,
				findingCounts: score.findingCounts ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				timestamp: score.timestamp,
				reviewId: score.id,
			};

			const existing = map.get(normalized);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(normalized, [entry]);
			}
		}
	}

	// Sort each file's entries by timestamp descending (most recent first)
	for (const entries of map.values()) {
		entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	}

	return map;
}

/**
 * Compute a health summary for a single file from its ordered entries.
 */
export function computeFileHealthSummary(filePath: string, entries: FileHealthEntry[]): FileHealthSummary {
	if (entries.length === 0) {
		return {
			filePath,
			currentScore: 100,
			averageScore: 100,
			previousScore: undefined,
			delta: undefined,
			reviewCount: 0,
			lastReviewedAt: '',
			findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
		};
	}

	const current = entries[0];
	const previous = entries.length > 1 ? entries[1] : undefined;
	const avgScore = Math.round(entries.reduce((sum, e) => sum + e.score, 0) / entries.length);

	return {
		filePath,
		currentScore: current.score,
		averageScore: avgScore,
		previousScore: previous?.score,
		delta: previous ? current.score - previous.score : undefined,
		reviewCount: entries.length,
		lastReviewedAt: current.timestamp,
		findingCounts: current.findingCounts,
	};
}

/**
 * Get health summaries for all tracked files, sorted by current score ascending (worst first).
 */
export function getHealthSummaries(scores: readonly ReviewScore[]): FileHealthSummary[] {
	const map = buildFileHealthMap(scores);
	const summaries: FileHealthSummary[] = [];

	for (const [filePath, entries] of map) {
		summaries.push(computeFileHealthSummary(filePath, entries));
	}

	summaries.sort((a, b) => a.currentScore - b.currentScore);
	return summaries;
}

/**
 * Get the top N worst-scoring files (hotspots).
 */
export function getHotspots(scores: readonly ReviewScore[], count: number): FileHealthSummary[] {
	return getHealthSummaries(scores).slice(0, count);
}

// ─── Regression detection ────────────────────────────────────────────────────

/**
 * Check for regressions in the files reviewed by the current review.
 * Compares the current review's score against each file's previous best score.
 *
 * @param currentScore The score entry just added to the store
 * @param allScores Full score history (including the current entry)
 * @param threshold Score drop that constitutes a regression
 */
export function detectRegressions(
	currentScore: ReviewScore,
	allScores: readonly ReviewScore[],
	threshold: number,
): RegressionResult {
	const files = currentScore.filesReviewed;
	if (!files || files.length === 0) {
		return { regressions: [], hasRegressions: false };
	}

	const regressions: FileRegression[] = [];

	// Build health map from all scores EXCEPT the current one
	const historicalScores = allScores.filter(s => s.id !== currentScore.id);
	const healthMap = buildFileHealthMap(historicalScores);

	for (const filePath of files) {
		const normalized = normalizePath(filePath);
		if (!normalized) { continue; }

		const history = healthMap.get(normalized);
		if (!history || history.length === 0) { continue; } // First review — no baseline

		const previousScore = history[0].score;
		const currentFileScore = currentScore.score;
		const delta = currentFileScore - previousScore;

		if (delta < 0 && Math.abs(delta) >= threshold) {
			regressions.push({
				filePath: normalized,
				previousScore,
				currentScore: currentFileScore,
				delta,
			});
		}
	}

	return {
		regressions,
		hasRegressions: regressions.length > 0,
	};
}

/**
 * Format a regression result into a user-friendly notification message.
 */
export function formatRegressionWarning(result: RegressionResult): string {
	if (!result.hasRegressions) { return ''; }

	const lines: string[] = [];
	for (const reg of result.regressions) {
		lines.push(`• ${reg.filePath}: ${reg.previousScore} → ${reg.currentScore} (${reg.delta})`);
	}

	const header = result.regressions.length === 1
		? '⚠️ Code health regression detected:'
		: `⚠️ Code health regressions detected in ${result.regressions.length} files:`;

	return `${header}\n${lines.join('\n')}`;
}

/**
 * Show a VS Code warning notification for regressions.
 */
export function notifyRegressions(result: RegressionResult, outputChannel?: vscode.OutputChannel): void {
	if (!result.hasRegressions) { return; }

	const message = result.regressions.length === 1
		? `Code health regression: ${result.regressions[0].filePath} dropped ${result.regressions[0].previousScore} → ${result.regressions[0].currentScore}`
		: `Code health regressions detected in ${result.regressions.length} files`;

	void vscode.window.showWarningMessage(message, 'View Hotspots').then(selection => {
		if (selection === 'View Hotspots') {
			void vscode.commands.executeCommand('ollama-code-review.showCodeHealth');
		}
	});

	if (outputChannel) {
		outputChannel.appendLine(`[Code Health] ${formatRegressionWarning(result)}`);
	}
}

// ─── Pre-commit guard integration ───────────────────────────────────────────

/**
 * Check if any files in the current review regressed and the guard is configured to block.
 * Returns true if the commit should be blocked.
 */
export function shouldBlockCommit(result: RegressionResult, config: CodeHealthConfig): boolean {
	return config.blockOnRegression && result.hasRegressions;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function normalizePath(filePath: string): string {
	// Strip leading slashes, 'a/', 'b/' prefixes from diff paths
	let normalized = filePath.replace(/^[ab]\//, '').replace(/^\/+/, '');
	// Normalize backslashes to forward slashes
	normalized = normalized.replace(/\\/g, '/');
	return normalized;
}
