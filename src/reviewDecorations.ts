/**
 * F-029: Review Annotations — Inline Editor Decorations
 *
 * Displays review findings as inline editor decorations: gutter icons,
 * line highlights, and hover tooltips directly in source files.
 * Users can see critical/high/medium/low/info findings in context
 * without switching to the review panel.
 */

import * as vscode from 'vscode';
import { type ReviewFinding, type Severity, parseReviewIntoFindings } from './github/commentMapper';

// ── Configuration ────────────────────────────────────────────────────

export interface AnnotationsConfig {
	enabled: boolean;
	showGutter: boolean;
	showLineHighlight: boolean;
	showHover: boolean;
}

export function getAnnotationsConfig(): AnnotationsConfig {
	const cfg = vscode.workspace.getConfiguration('ollama-code-review');
	const raw = cfg.get<Partial<AnnotationsConfig>>('annotations', {});
	return {
		enabled: raw.enabled ?? true,
		showGutter: raw.showGutter ?? true,
		showLineHighlight: raw.showLineHighlight ?? true,
		showHover: raw.showHover ?? true,
	};
}

// ── Severity Styling ─────────────────────────────────────────────────

interface SeverityStyle {
	gutterIcon: string;  // ThemeIcon ID
	gutterColor: string; // CSS color for overview ruler
	bgColor: string;     // Background highlight
	label: string;
}

const SEVERITY_STYLES: Record<Severity, SeverityStyle> = {
	critical: {
		gutterIcon: 'error',
		gutterColor: '#e51400',
		bgColor: 'rgba(229, 20, 0, 0.08)',
		label: 'Critical',
	},
	high: {
		gutterIcon: 'warning',
		gutterColor: '#e5a100',
		bgColor: 'rgba(229, 161, 0, 0.08)',
		label: 'High',
	},
	medium: {
		gutterIcon: 'info',
		gutterColor: '#007acc',
		bgColor: 'rgba(0, 122, 204, 0.06)',
		label: 'Medium',
	},
	low: {
		gutterIcon: 'lightbulb',
		gutterColor: '#66bb6a',
		bgColor: 'rgba(102, 187, 106, 0.06)',
		label: 'Low',
	},
	info: {
		gutterIcon: 'comment',
		gutterColor: '#888888',
		bgColor: 'rgba(136, 136, 136, 0.04)',
		label: 'Info',
	},
};

// ── Singleton Manager ────────────────────────────────────────────────

export class ReviewDecorationsManager {
	private static _instance: ReviewDecorationsManager | undefined;

	/** One decoration type per severity level */
	private decorationTypes = new Map<Severity, vscode.TextEditorDecorationType>();

	/** Stored decorations per file path → { severity → ranges } */
	private fileDecorations = new Map<string, Map<Severity, vscode.DecorationOptions[]>>();

	/** Current findings (for re-apply on editor change) */
	private currentFindings: ReviewFinding[] = [];
	private currentDiff = '';

	private annotationsVisible = true;
	private disposables: vscode.Disposable[] = [];

	private constructor() {
		this.createDecorationTypes();

		// Re-apply when the active editor changes
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor && this.annotationsVisible) {
					this.applyToEditor(editor);
				}
			})
		);
	}

	static getInstance(): ReviewDecorationsManager {
		if (!ReviewDecorationsManager._instance) {
			ReviewDecorationsManager._instance = new ReviewDecorationsManager();
		}
		return ReviewDecorationsManager._instance;
	}

	// ── Decoration Type Creation ──────────────────────────────────────

	private createDecorationTypes(): void {
		const config = getAnnotationsConfig();

		for (const [sev, style] of Object.entries(SEVERITY_STYLES) as [Severity, SeverityStyle][]) {
			const opts: vscode.DecorationRenderOptions = {
				overviewRulerColor: style.gutterColor,
				overviewRulerLane: vscode.OverviewRulerLane.Left,
				isWholeLine: true,
			};

			if (config.showGutter) {
				opts.gutterIconPath = new vscode.ThemeIcon(style.gutterIcon) as unknown as string;
			}

			if (config.showLineHighlight) {
				opts.backgroundColor = style.bgColor;
			}

			// After-line summary text
			opts.after = {
				margin: '0 0 0 2em',
				color: new vscode.ThemeColor('editorCodeLens.foreground'),
				fontStyle: 'italic',
			};

			this.decorationTypes.set(sev, vscode.window.createTextEditorDecorationType(opts));
		}
	}

	// ── Public API ────────────────────────────────────────────────────

	/**
	 * Parse findings from a completed review and apply decorations to
	 * all open editors that match finding file paths.
	 */
	applyFromReview(reviewText: string, diff: string): void {
		const config = getAnnotationsConfig();
		if (!config.enabled) { return; }

		this.currentDiff = diff;
		this.currentFindings = parseReviewIntoFindings(reviewText, diff);

		this.buildFileDecorations();

		if (this.annotationsVisible) {
			this.applyToAllVisibleEditors();
		}
	}

	/** Toggle visibility of all annotations. */
	toggleAnnotations(): boolean {
		this.annotationsVisible = !this.annotationsVisible;
		if (this.annotationsVisible) {
			this.applyToAllVisibleEditors();
		} else {
			this.clearAllEditorDecorations();
		}
		return this.annotationsVisible;
	}

	/** Remove all decorations and clear state. */
	clearAll(): void {
		this.currentFindings = [];
		this.currentDiff = '';
		this.fileDecorations.clear();
		this.clearAllEditorDecorations();
	}

	/** Get the current finding count by severity. */
	getFindingSummary(): Record<Severity, number> {
		const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
		for (const f of this.currentFindings) {
			if (f.file) { counts[f.severity]++; }
		}
		return counts;
	}

	/** Dispose all decoration types and listeners. */
	dispose(): void {
		for (const dt of this.decorationTypes.values()) { dt.dispose(); }
		this.decorationTypes.clear();
		for (const d of this.disposables) { d.dispose(); }
		this.disposables = [];
		ReviewDecorationsManager._instance = undefined;
	}

	// ── Internal ──────────────────────────────────────────────────────

	private buildFileDecorations(): void {
		this.fileDecorations.clear();
		const config = getAnnotationsConfig();

		for (const finding of this.currentFindings) {
			if (!finding.file || finding.line === undefined) { continue; }

			const filePath = finding.file;
			if (!this.fileDecorations.has(filePath)) {
				this.fileDecorations.set(filePath, new Map());
			}
			const sevMap = this.fileDecorations.get(filePath)!;
			if (!sevMap.has(finding.severity)) {
				sevMap.set(finding.severity, []);
			}

			const line = Math.max(0, finding.line - 1); // VS Code is 0-indexed
			const style = SEVERITY_STYLES[finding.severity];

			// Truncate message for inline display
			const shortMsg = finding.message.length > 120
				? finding.message.slice(0, 117) + '...'
				: finding.message;

			const decoration: vscode.DecorationOptions = {
				range: new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
				renderOptions: {
					after: {
						contentText: ` ${style.label}: ${shortMsg}`,
					},
				},
			};

			// Hover message with full details
			if (config.showHover) {
				const md = new vscode.MarkdownString();
				md.isTrusted = true;
				md.appendMarkdown(`**${style.label} Finding** \n\n`);
				md.appendMarkdown(finding.message + '\n\n');
				if (finding.suggestion) {
					md.appendMarkdown('**Suggestion:**\n');
					md.appendCodeblock(finding.suggestion, 'typescript');
				}
				decoration.hoverMessage = md;
			}

			sevMap.get(finding.severity)!.push(decoration);
		}
	}

	private applyToAllVisibleEditors(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.applyToEditor(editor);
		}
	}

	private applyToEditor(editor: vscode.TextEditor): void {
		const editorPath = vscode.workspace.asRelativePath(editor.document.uri);

		// Find matching file decorations (support partial path matching)
		const matched = this.findMatchingFile(editorPath);
		if (!matched) {
			// Clear any stale decorations on this editor
			for (const dt of this.decorationTypes.values()) {
				editor.setDecorations(dt, []);
			}
			return;
		}

		const sevMap = this.fileDecorations.get(matched)!;
		for (const [sev, dt] of this.decorationTypes) {
			const options = sevMap.get(sev) ?? [];
			editor.setDecorations(dt, options);
		}
	}

	private findMatchingFile(editorPath: string): string | undefined {
		// Exact match first
		if (this.fileDecorations.has(editorPath)) { return editorPath; }

		// Partial match: finding path may be "src/foo.ts" while editor path is "foo.ts" or vice versa
		for (const filePath of this.fileDecorations.keys()) {
			if (editorPath.endsWith(filePath) || filePath.endsWith(editorPath)) {
				return filePath;
			}
		}
		return undefined;
	}

	private clearAllEditorDecorations(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			for (const dt of this.decorationTypes.values()) {
				editor.setDecorations(dt, []);
			}
		}
	}
}
