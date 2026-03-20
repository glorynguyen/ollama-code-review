/**
 * F-043: Auto-Review on Save — Background Code Quality Monitor
 *
 * Watches for file save events, debounces them per-file, and silently runs an
 * AI review in the background.  When issues above the configured severity
 * threshold are found the user gets a non-blocking status-bar update and an
 * optional pop-up notification.
 *
 * TOKEN EFFICIENCY — two-level cache:
 *
 *   1. Content cache  — if the file has not changed since the last review,
 *      the API call is skipped entirely (0 tokens).
 *
 *   2. Diff mode      — if the file HAS changed but we have a previous version
 *      cached, only the unified diff (changed lines + context) is sent to the
 *      AI instead of the full file.  For a 300-line file with a 10-line edit,
 *      this typically reduces the payload by ~90 %.
 *
 * The manager is a singleton created once in `commands/index.ts` → `activate()`
 * and passed two thin callbacks so it does not need to import the heavyweight
 * AI pipeline directly:
 *
 *   - `reviewFn`        – runs the AI review and returns the review text
 *   - `applyAnnotations` – applies inline editor decorations for findings
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { parseFindingCounts } from '../reviewScore';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AutoReviewConfig {
	/** Enable automatic reviews on file save. Default: false */
	enabled: boolean;
	/** Milliseconds to wait after the last save before triggering a review. Default: 3000 */
	debounceMs: number;
	/** Only show notifications for findings at this severity or above. Default: 'high' */
	minSeverity: 'critical' | 'high' | 'medium' | 'low';
	/** Glob-style patterns for files/directories to skip. Default: node_modules, tests, dist. */
	excludePatterns: string[];
	/** Apply inline editor annotations after every auto-review. Default: true */
	showAnnotations: boolean;
	/** Show a pop-up notification when findings are found above minSeverity. Default: true */
	notifyOnFindings: boolean;
	/**
	 * Ask before running the AI review.
	 * When true, a prompt appears after each debounce showing the file name and
	 * changed-line count so you can choose to review or skip.
	 * When false (default), the review runs silently in the background.
	 * Default: false
	 */
	confirmBeforeReview: boolean;
}

/** Callback that runs an AI review of `content` (or a unified diff) and returns the review markdown. */
export type ReviewFn = (content: string, label: string) => Promise<string>;

/** Callback that applies inline annotations for the file. */
export type ApplyAnnotationsFn = (reviewText: string, pseudoDiff: string) => void;

// ---------------------------------------------------------------------------
// Internal cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
	/** The full content that was last sent to the AI for this file. */
	content: string;
	/** Unix timestamp (ms) of when this entry was created. */
	reviewedAt: number;
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

/** Higher number = more severe */
const SEVERITY_WEIGHT: Record<string, number> = {
	critical: 4,
	high: 3,
	medium: 2,
	low: 1,
	info: 0,
};

/** Supported language identifiers for auto-review. */
const SUPPORTED_LANGUAGES = new Set([
	'typescript', 'typescriptreact',
	'javascript', 'javascriptreact',
	'python', 'rust', 'go', 'java',
	'php', 'ruby', 'css', 'scss', 'html',
	'vue', 'svelte', 'c', 'cpp', 'csharp',
	'swift', 'kotlin',
]);

/** Max file lines before we fall back to sending the full new content (LCS is O(n*m)). */
const LCS_LINE_LIMIT = 500;

/** Number of unchanged lines to include above and below each changed hunk. */
const DIFF_CONTEXT_LINES = 3;

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

/**
 * Compute a compact unified diff between `oldContent` and `newContent`.
 *
 * Returns:
 *   - `null`   — files are identical; no API call needed.
 *   - a diff string — only the changed hunks with context lines.
 *
 * Falls back to returning `newContent` unchanged when:
 *   - either file exceeds LCS_LINE_LIMIT lines (LCS would be too slow), or
 *   - the diff is larger than half the new file (large refactor — full file is
 *     more useful context than a giant diff).
 */
function computeDiff(
	oldContent: string,
	newContent: string,
	filePath: string,
): string | null {
	if (oldContent === newContent) { return null; }

	const oldLines = oldContent.split('\n');
	const newLines = newContent.split('\n');

	// For very large files use the full new content (LCS is too slow).
	if (oldLines.length > LCS_LINE_LIMIT || newLines.length > LCS_LINE_LIMIT) {
		return newContent;
	}

	const editScript = _lcsEditScript(oldLines, newLines);
	const hunks = _buildHunks(editScript, oldLines, newLines, DIFF_CONTEXT_LINES);

	if (hunks.length === 0) { return null; }

	// Count changed lines across all hunks.
	const changedLines = hunks.reduce(
		(sum, h) => sum + h.lines.filter(l => l[0] !== ' ').length,
		0,
	);

	// If more than 50 % of the new file changed, it's a large refactor —
	// send the full file so the AI has complete context.
	if (changedLines > newLines.length * 0.5) {
		return newContent;
	}

	const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
	const body = hunks.map(_formatHunk).join('\n');
	return header + body;
}

// ---------------------------------------------------------------------------
// LCS-based diff internals
// ---------------------------------------------------------------------------

type EditOp = { op: 'eq' | 'ins' | 'del'; line: string };

/**
 * Compute a minimal edit script (delete/insert/equal operations) between two
 * line arrays using the standard LCS dynamic-programming algorithm.
 * Complexity: O(m * n) time and space — only called when both arrays are
 * within LCS_LINE_LIMIT lines.
 */
function _lcsEditScript(oldLines: string[], newLines: string[]): EditOp[] {
	const m = oldLines.length;
	const n = newLines.length;

	// Build DP table.
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to reconstruct the edit script.
	const result: EditOp[] = [];
	let i = m;
	let j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			result.unshift({ op: 'eq', line: oldLines[i - 1] });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			result.unshift({ op: 'ins', line: newLines[j - 1] });
			j--;
		} else {
			result.unshift({ op: 'del', line: oldLines[i - 1] });
			i--;
		}
	}

	return result;
}

interface Hunk {
	/** Starting line number in the old file (1-based). */
	oldStart: number;
	/** Number of lines from old file in this hunk. */
	oldCount: number;
	/** Starting line number in the new file (1-based). */
	newStart: number;
	/** Number of lines from new file in this hunk. */
	newCount: number;
	/** Lines with prefix: ' ' (context), '+' (added), '-' (deleted). */
	lines: string[];
}

/**
 * Group an edit script into unified-diff hunks with `contextLines` unchanged
 * lines before and after each changed region.
 */
function _buildHunks(
	editScript: EditOp[],
	_oldLines: string[],
	_newLines: string[],
	contextLines: number,
): Hunk[] {
	const hunks: Hunk[] = [];

	// Compute position counters for the formatted lines.
	let oldLine = 1;
	let newLine = 1;

	// Mark which indices in editScript are "changed" (ins or del).
	const isChanged = editScript.map(op => op.op !== 'eq');

	let i = 0;
	while (i < editScript.length) {
		// Skip equal lines that are not near any change.
		if (!isChanged[i]) {
			const nearChange = editScript
				.slice(Math.max(0, i - contextLines), i + contextLines + 1)
				.some(op => op.op !== 'eq');
			if (!nearChange) {
				if (editScript[i].op === 'eq') { oldLine++; newLine++; }
				i++;
				continue;
			}
		}

		// Start of a new hunk — collect context before + changed + context after.
		const hunkStart = i;
		const hunkStartOld = oldLine;
		const hunkStartNew = newLine;
		const hunkLines: string[] = [];

		// Find the end of the changed region (with trailing context).
		let end = i;
		while (end < editScript.length) {
			// Find next changed line from `end`.
			let nextChange = end;
			while (nextChange < editScript.length && !isChanged[nextChange]) {
				nextChange++;
			}
			if (nextChange === editScript.length) { break; }
			// Include up to contextLines equal lines after the last change.
			end = Math.min(nextChange + contextLines, editScript.length);
			// Is there another changed line within this context window?
			const nextChangeAfter = editScript
				.slice(nextChange + 1, end + contextLines + 1)
				.findIndex(op => op.op !== 'eq');
			if (nextChangeAfter === -1) {
				// No more changes within context — stop here.
				break;
			}
			end = nextChange + 1 + nextChangeAfter + contextLines;
			if (end >= editScript.length) { break; }
		}
		end = Math.min(end, editScript.length);

		// Collect lines for the hunk.
		let hunkOld = 0;
		let hunkNew = 0;
		for (let k = hunkStart; k < end; k++) {
			const op = editScript[k];
			if (op.op === 'eq') {
				hunkLines.push(` ${op.line}`);
				hunkOld++;
				hunkNew++;
			} else if (op.op === 'del') {
				hunkLines.push(`-${op.line}`);
				hunkOld++;
			} else {
				hunkLines.push(`+${op.line}`);
				hunkNew++;
			}
		}

		// Advance global line counters to end of hunk.
		for (let k = hunkStart; k < end; k++) {
			const op = editScript[k];
			if (op.op !== 'ins') { oldLine++; }
			if (op.op !== 'del') { newLine++; }
		}

		hunks.push({
			oldStart: hunkStartOld,
			oldCount: hunkOld,
			newStart: hunkStartNew,
			newCount: hunkNew,
			lines: hunkLines,
		});

		i = end;
	}

	return hunks;
}

function _formatHunk(hunk: Hunk): string {
	const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
	return [header, ...hunk.lines].join('\n');
}

// ---------------------------------------------------------------------------
// AutoReviewManager
// ---------------------------------------------------------------------------

export class AutoReviewManager implements vscode.Disposable {
	private static _instance: AutoReviewManager | undefined;

	private readonly _disposables: vscode.Disposable[] = [];
	/** Per-file debounce timers (key = document URI string). */
	private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Files currently being reviewed (to avoid overlapping runs on the same file). */
	private readonly _activeReviews = new Set<string>();
	/**
	 * Content cache — stores the full text that was last sent to the AI for
	 * each file.  Used to:
	 *   (a) skip the API call entirely when nothing has changed, and
	 *   (b) compute a diff instead of re-sending the whole file.
	 */
	private readonly _contentCache = new Map<string, CacheEntry>();

	private readonly _statusBarItem: vscode.StatusBarItem;

	private constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _reviewFn: ReviewFn,
		private readonly _applyAnnotations: ApplyAnnotationsFn | undefined,
		private readonly _outputChannel: vscode.OutputChannel | undefined,
	) {
		// Status bar item — always visible so the user knows the feature exists.
		this._statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			// Slot between score (97) and profile (99) items.
			96,
		);
		this._statusBarItem.command = 'ollama-code-review.toggleAutoReview';
		this._updateStatusBar();
		this._statusBarItem.show();
		this._disposables.push(this._statusBarItem);

		// Always register the save listener; enabled check happens inside _onSave.
		this._disposables.push(
			vscode.workspace.onDidSaveTextDocument(doc => this._onSave(doc)),
		);

		// Evict cache when a file is closed (to free memory).
		this._disposables.push(
			vscode.workspace.onDidCloseTextDocument(doc => {
				this._contentCache.delete(doc.uri.toString());
			}),
		);

		// React to config changes (user toggles the setting manually).
		this._disposables.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('ollama-code-review.autoReview')) {
					this._updateStatusBar();
				}
			}),
		);
	}

	// ---------------------------------------------------------------------------
	// Factory / singleton
	// ---------------------------------------------------------------------------

	static create(
		context: vscode.ExtensionContext,
		reviewFn: ReviewFn,
		applyAnnotations?: ApplyAnnotationsFn,
		outputChannel?: vscode.OutputChannel,
	): AutoReviewManager {
		if (!AutoReviewManager._instance) {
			AutoReviewManager._instance = new AutoReviewManager(
				context, reviewFn, applyAnnotations, outputChannel,
			);
		}
		return AutoReviewManager._instance;
	}

	static getInstance(): AutoReviewManager | undefined {
		return AutoReviewManager._instance;
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/** Read the current configuration from VS Code settings. */
	getConfig(): AutoReviewConfig {
		const cfg = vscode.workspace.getConfiguration('ollama-code-review.autoReview');
		return {
			enabled: cfg.get<boolean>('enabled', false),
			debounceMs: Math.max(500, cfg.get<number>('debounceMs', 3000)),
			minSeverity: cfg.get<'critical' | 'high' | 'medium' | 'low'>('minSeverity', 'high'),
			excludePatterns: cfg.get<string[]>('excludePatterns', [
				'**/node_modules/**',
				'**/*.test.*',
				'**/*.spec.*',
				'**/__tests__/**',
				'**/dist/**',
				'**/build/**',
				'**/out/**',
				'**/.next/**',
			]),
			showAnnotations: cfg.get<boolean>('showAnnotations', true),
			notifyOnFindings: cfg.get<boolean>('notifyOnFindings', true),
			confirmBeforeReview: cfg.get<boolean>('confirmBeforeReview', false),
		};
	}

	/**
	 * Toggle the auto-review feature on/off.
	 * Persists the change to global VS Code settings.
	 * @returns The new `enabled` state.
	 */
	toggle(): boolean {
		const topLevel = vscode.workspace.getConfiguration('ollama-code-review');
		const current = topLevel.get<Record<string, unknown>>('autoReview', {});
		const newEnabled = !(current.enabled ?? false);
		topLevel.update(
			'autoReview',
			{ ...current, enabled: newEnabled },
			vscode.ConfigurationTarget.Global,
		);
		this._updateStatusBar();
		return newEnabled;
	}

	// ---------------------------------------------------------------------------
	// Private — save handler
	// ---------------------------------------------------------------------------

	private _onSave(doc: vscode.TextDocument): void {
		const cfg = this.getConfig();
		if (!cfg.enabled) { return; }

		// Skip unsupported file types.
		if (!SUPPORTED_LANGUAGES.has(doc.languageId)) { return; }

		// Skip files that match an exclusion pattern.
		const relPath = vscode.workspace.asRelativePath(doc.uri);
		if (this._isExcluded(relPath, cfg.excludePatterns)) { return; }

		// Skip very large files (> 200 KB).
		if (doc.getText().length > 200 * 1024) { return; }

		// Debounce: cancel any existing timer for this file, then set a new one.
		const key = doc.uri.toString();
		const existing = this._timers.get(key);
		if (existing !== undefined) { clearTimeout(existing); }

		const timer = setTimeout(() => {
			this._timers.delete(key);
			void this._runReview(doc);
		}, cfg.debounceMs);

		this._timers.set(key, timer);
	}

	// ---------------------------------------------------------------------------
	// Private — review execution
	// ---------------------------------------------------------------------------

	private async _runReview(doc: vscode.TextDocument): Promise<void> {
		const key = doc.uri.toString();

		// Avoid parallel reviews of the same file.
		if (this._activeReviews.has(key)) { return; }
		this._activeReviews.add(key);
		this._updateStatusBar();

		const relPath = vscode.workspace.asRelativePath(doc.uri);
		this._outputChannel?.appendLine(`[Auto-Review] Processing ${relPath}…`);

		try {
			const currentContent = doc.getText();
			const cfg = this.getConfig();
			const cached = this._contentCache.get(key);

			// ---------------------------------------------------------------
			// Level 1: skip if nothing changed since the last review.
			// ---------------------------------------------------------------
			if (cached && cached.content === currentContent) {
				this._outputChannel?.appendLine(
					`[Auto-Review] Skipped ${relPath} — no changes since last review.`,
				);
				return;
			}

			// ---------------------------------------------------------------
			// Level 2: send only the diff if we have a previous version.
			// ---------------------------------------------------------------
			let payload: string;
			let label: string;

			if (cached) {
				const diff = computeDiff(cached.content, currentContent, relPath);

				if (diff === null) {
					// computeDiff found no semantic changes (e.g. only blank lines).
					this._outputChannel?.appendLine(
						`[Auto-Review] Skipped ${relPath} — diff is empty.`,
					);
					// Update cache so we don't keep trying.
					this._contentCache.set(key, { content: currentContent, reviewedAt: Date.now() });
					return;
				}

				if (diff === currentContent) {
					// Fell back to full content (large file / large refactor).
					payload = currentContent;
					label = `[Auto-Review: ${relPath}]`;
					this._outputChannel?.appendLine(
						`[Auto-Review] Sending full file (large diff) for ${relPath}`,
					);
				} else {
					payload = diff;
					label = `[Auto-Review diff: ${relPath}]`;
					const diffLines = diff.split('\n').length;
					const fullLines = currentContent.split('\n').length;
					this._outputChannel?.appendLine(
						`[Auto-Review] Sending diff (${diffLines} lines vs ${fullLines} full) for ${relPath}`,
					);
				}
			} else {
				// First review of this file in this session — send full content.
				payload = currentContent;
				label = `[Auto-Review: ${relPath}]`;
				this._outputChannel?.appendLine(
					`[Auto-Review] First review — sending full file for ${relPath}`,
				);
			}

			// ---------------------------------------------------------------
			// Confirmation prompt (when confirmBeforeReview is enabled).
			// Shown after the diff is computed so we can report how many lines
			// changed — the user can then decide whether a review call is worth it.
			// ---------------------------------------------------------------
			if (cfg.confirmBeforeReview) {
				// Count only added/removed lines (exclude diff headers and context lines).
				const changedLines = (payload === currentContent)
					? currentContent.split('\n').length
					: payload.split('\n').filter(
						l => (l.startsWith('+') || l.startsWith('-')) &&
							!l.startsWith('+++') && !l.startsWith('---'),
					).length;

				const basename = path.basename(relPath);
				const lineLabel = changedLines === 1 ? '1 line changed' : `${changedLines} lines changed`;

				const answer = await vscode.window.showInformationMessage(
					`Auto-Review: ${basename} saved (${lineLabel}). Review now?`,
					{ modal: false },
					'Review',
					'Skip',
				);

				if (answer !== 'Review') {
					this._outputChannel?.appendLine(
						`[Auto-Review] User skipped review for ${relPath}.`,
					);
					return;
				}
			}

			// ---------------------------------------------------------------
			// Run the AI review.
			// ---------------------------------------------------------------
			const review = await this._reviewFn(payload, label);

			// Update the cache with the content we just reviewed.
			this._contentCache.set(key, { content: currentContent, reviewedAt: Date.now() });

			// Apply inline annotations (non-fatal if applyAnnotations is not provided).
			if (cfg.showAnnotations && this._applyAnnotations) {
				// Build a minimal pseudo-diff so the annotation mapper can resolve the file.
				const pseudoDiff = `--- a/${relPath}\n+++ b/${relPath}\n`;
				this._applyAnnotations(review, pseudoDiff);
			}

			// Count findings using the canonical scoring helper.
			const counts = parseFindingCounts(review);
			const total = counts.critical + counts.high + counts.medium + counts.low + counts.info;

			const minWeight = SEVERITY_WEIGHT[cfg.minSeverity] ?? SEVERITY_WEIGHT.high;
			const notifyCount =
				(SEVERITY_WEIGHT.critical >= minWeight ? counts.critical : 0) +
				(SEVERITY_WEIGHT.high >= minWeight ? counts.high : 0) +
				(SEVERITY_WEIGHT.medium >= minWeight ? counts.medium : 0) +
				(SEVERITY_WEIGHT.low >= minWeight ? counts.low : 0);

			const basename = path.basename(relPath);
			this._outputChannel?.appendLine(
				`[Auto-Review] Done: ${relPath} — ` +
				`critical=${counts.critical} high=${counts.high} medium=${counts.medium} ` +
				`low=${counts.low} info=${counts.info}`,
			);

			if (notifyCount > 0 && cfg.notifyOnFindings) {
				const parts: string[] = [];
				if (counts.critical > 0) { parts.push(`${counts.critical} critical`); }
				if (counts.high > 0) { parts.push(`${counts.high} high`); }
				if (counts.medium > 0 && SEVERITY_WEIGHT.medium >= minWeight) { parts.push(`${counts.medium} medium`); }
				if (counts.low > 0 && SEVERITY_WEIGHT.low >= minWeight) { parts.push(`${counts.low} low`); }

				const action = await vscode.window.showWarningMessage(
					`Auto-Review: ${notifyCount} issue(s) in ${basename} (${parts.join(', ')})`,
					'View Review',
					'Dismiss',
				);
				if (action === 'View Review') {
					// Trigger a full file review so the panel opens with results.
					await vscode.commands.executeCommand('ollama-code-review.reviewFile', doc.uri);
				}
			} else if (total === 0) {
				this._outputChannel?.appendLine(`[Auto-Review] ${relPath} looks clean.`);
			}
		} catch (err) {
			this._outputChannel?.appendLine(`[Auto-Review] Error reviewing ${relPath}: ${err}`);
		} finally {
			this._activeReviews.delete(key);
			this._updateStatusBar();
		}
	}

	// ---------------------------------------------------------------------------
	// Private — helpers
	// ---------------------------------------------------------------------------

	/**
	 * Minimal glob-style pattern matching.
	 * Supports `**` (any path segment) and `*` (any characters within a segment).
	 */
	private _isExcluded(filePath: string, patterns: string[]): boolean {
		return patterns.some(pattern => {
			// Normalise Windows path separators.
			const normalised = filePath.replace(/\\/g, '/');
			// Convert glob pattern to regex:
			//   **/ → match zero or more directory segments
			//   *   → match any characters except /
			const regexStr = pattern
				.replace(/\\/g, '/')
				.replace(/[.+^${}()|[\]]/g, '\\$&') // escape regex special chars (not * or ?)
				.replace(/\*\*\//g, '(?:.+/)?')       // **/ → optional directory prefix
				.replace(/\*\*/g, '.*')                // ** → any chars
				.replace(/\*/g, '[^/]*');              // * → any chars within a segment
			try {
				return new RegExp(`^${regexStr}$`).test(normalised) ||
					new RegExp(regexStr).test(normalised);
			} catch {
				return false;
			}
		});
	}

	private _updateStatusBar(): void {
		const cfg = this.getConfig();
		const active = this._activeReviews.size;

		if (!cfg.enabled) {
			this._statusBarItem.text = '$(eye-closed) Auto';
			this._statusBarItem.tooltip = 'Auto-Review on Save: OFF — click to enable';
			this._statusBarItem.backgroundColor = undefined;
		} else if (active > 0) {
			this._statusBarItem.text = `$(sync~spin) Auto (${active})`;
			this._statusBarItem.tooltip = `Auto-Review: reviewing ${active} file(s)…`;
			this._statusBarItem.backgroundColor = undefined;
		} else {
			this._statusBarItem.text = '$(eye) Auto';
			this._statusBarItem.tooltip = 'Auto-Review on Save: ON — click to disable';
			this._statusBarItem.backgroundColor = undefined;
		}
	}

	// ---------------------------------------------------------------------------
	// Disposable
	// ---------------------------------------------------------------------------

	dispose(): void {
		for (const timer of this._timers.values()) { clearTimeout(timer); }
		this._timers.clear();
		this._contentCache.clear();
		this._disposables.forEach(d => d.dispose());
		AutoReviewManager._instance = undefined;
	}
}
