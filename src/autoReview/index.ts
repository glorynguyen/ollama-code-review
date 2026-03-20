/**
 * F-043: Auto-Review on Save — Background Code Quality Monitor
 *
 * Watches for file save events, debounces them per-file, and silently runs an
 * AI review in the background.  When issues above the configured severity
 * threshold are found the user gets a non-blocking status-bar update and an
 * optional pop-up notification.
 *
 * TOKEN EFFICIENCY — three-level strategy:
 *
 *   1. Git diff check  — runs `git diff HEAD -- <file>`.  If the file has no
 *      diff against HEAD the review is skipped entirely (0 tokens).
 *
 *   2. Smart context   — instead of sending the whole file, the payload is:
 *        • the raw git diff (changed hunks)
 *        • the wrapping function body for each changed line
 *        • called functions (BFS up to depth 2, max 8 functions)
 *        • relevant import statements
 *      For a typical 10-line edit this reduces the payload by ~80-90 % vs
 *      sending the full file.
 *
 *   3. Untracked fallback — new files not yet tracked by git are sent in full
 *      on the first save; subsequent saves use the same git-diff path once the
 *      file has been committed.
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
import { getGitDiff } from './gitDiff';
import { buildSmartContext } from './smartContext';
import { MonorepoResolver } from './monorepo';

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
	/**
	 * Use smart context (wrapping function + call graph) instead of sending
	 * only the raw diff.  Requires a language server to be active for the file.
	 * Default: true
	 */
	useSmartContext: boolean;
}

/** Callback that runs an AI review of `content` (or a unified diff) and returns the review markdown. */
export type ReviewFn = (content: string, label: string) => Promise<string>;

/** Callback that applies inline annotations for the file. */
export type ApplyAnnotationsFn = (reviewText: string, pseudoDiff: string) => void;

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

	private readonly _statusBarItem: vscode.StatusBarItem;

	/**
	 * Monorepo-aware resolver for following cross-package definitions.
	 * Lazily created on first use and shared across all reviews.
	 */
	private readonly _resolver: MonorepoResolver;

	private constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _reviewFn: ReviewFn,
		private readonly _applyAnnotations: ApplyAnnotationsFn | undefined,
		private readonly _outputChannel: vscode.OutputChannel | undefined,
	) {
		this._resolver = new MonorepoResolver();
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

	/**
	 * The monorepo resolver used by the smart-context builder.
	 * Call `resolver.registerStrategy(...)` to add support for custom monorepo
	 * layouts (Nx, Lerna, Rush, etc.) beyond the built-in strategies.
	 */
	get resolver(): MonorepoResolver { return this._resolver; }

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
			useSmartContext: cfg.get<boolean>('useSmartContext', true),
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

			// ---------------------------------------------------------------
			// Step 1: Get the git diff for this file.
			// ---------------------------------------------------------------
			const filePath = doc.uri.fsPath;
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
			const cwd = workspaceFolder?.uri.fsPath ?? path.dirname(filePath);

			const gitResult = await getGitDiff(filePath, currentContent, cwd);

			if (gitResult.kind === 'unchanged') {
				this._outputChannel?.appendLine(
					`[Auto-Review] Skipped ${relPath} — no changes vs HEAD.`,
				);
				return;
			}

			if (gitResult.kind === 'error') {
				this._outputChannel?.appendLine(
					`[Auto-Review] Git error for ${relPath}: ${gitResult.message} — falling back to full file.`,
				);
				// Fall back to full file review when git is not available.
			}

			// ---------------------------------------------------------------
			// Step 2: Build the review payload.
			// ---------------------------------------------------------------
			let payload: string;
			let label: string;
			let changedLineCount = 0;

			if (gitResult.kind === 'diff') {
				const diff = gitResult.diff;

				if (cfg.useSmartContext) {
					// Smart context: wrapping function + call graph + imports.
					// Pass the monorepo resolver so cross-package definitions
					// (e.g. @myapp/shared via node_modules symlinks) are followed.
					const smartCtx = await buildSmartContext(doc.uri, diff, {
						resolver: this._resolver,
						workspaceRoot: cwd,
					});

					if (smartCtx.functionCount > 0) {
						payload =
							`## Git Diff (${relPath})\n\`\`\`diff\n${diff}\n\`\`\`\n\n` +
							smartCtx.context;
						label = `[Auto-Review smart: ${relPath}]`;
						this._outputChannel?.appendLine(
							`[Auto-Review] Smart context: ${smartCtx.functionCount} function(s), ` +
							`${payload.length} chars for ${relPath}`,
						);
					} else {
						// Language server returned no symbols (e.g. not yet indexed).
						payload = diff;
						label = `[Auto-Review diff: ${relPath}]`;
						this._outputChannel?.appendLine(
							`[Auto-Review] No symbols found — sending raw diff for ${relPath}`,
						);
					}
				} else {
					payload = diff;
					label = `[Auto-Review diff: ${relPath}]`;
					this._outputChannel?.appendLine(
						`[Auto-Review] Sending raw diff (${diff.split('\n').length} lines) for ${relPath}`,
					);
				}

				changedLineCount = diff.split('\n').filter(
					l => (l.startsWith('+') || l.startsWith('-')) &&
						!l.startsWith('+++') && !l.startsWith('---'),
				).length;

			} else if (gitResult.kind === 'untracked') {
				// New file — send full content.
				payload = currentContent;
				label = `[Auto-Review new file: ${relPath}]`;
				changedLineCount = currentContent.split('\n').length;
				this._outputChannel?.appendLine(
					`[Auto-Review] Untracked file — sending full content for ${relPath}`,
				);
			} else {
				// Error fallback — send full content.
				payload = currentContent;
				label = `[Auto-Review: ${relPath}]`;
				changedLineCount = currentContent.split('\n').length;
			}

			// ---------------------------------------------------------------
			// Step 3: Confirmation prompt (when confirmBeforeReview is enabled).
			// ---------------------------------------------------------------
			if (cfg.confirmBeforeReview) {
				const basename = path.basename(relPath);
				const lineLabel = changedLineCount === 1
					? '1 line changed'
					: `${changedLineCount} lines changed`;

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
			// Step 4: Run the AI review.
			// ---------------------------------------------------------------
			const review = await this._reviewFn(payload, label);

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
		this._disposables.forEach(d => d.dispose());
		AutoReviewManager._instance = undefined;
	}
}
