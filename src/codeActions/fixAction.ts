import * as vscode from 'vscode';
import * as path from 'path';
import { escapeHtml } from '../utils';

/**
 * Code Action Provider for "Fix This Issue" functionality
 * Applies AI-suggested fixes to specific issues in code
 */
export class FixIssueActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		context: vscode.CodeActionContext
	): vscode.CodeAction[] | undefined {
		// Only show when there's a selection or diagnostics
		if (range.isEmpty && context.diagnostics.length === 0) {
			return undefined;
		}

		const actions: vscode.CodeAction[] = [];

		// If there are diagnostics (errors/warnings), offer to fix them
		if (context.diagnostics.length > 0) {
			for (const diagnostic of context.diagnostics) {
				const fixAction = new vscode.CodeAction(
					`Ollama: Fix "${this._truncateMessage(diagnostic.message)}"`,
					vscode.CodeActionKind.QuickFix
				);

				fixAction.command = {
					command: 'ollama-code-review.fixIssue',
					title: 'Fix this issue',
					tooltip: 'Ask Ollama to fix this issue',
					arguments: [document, diagnostic]
				};

				fixAction.diagnostics = [diagnostic];
				actions.push(fixAction);
			}
		}

		// If there's a selection, offer general fix
		if (!range.isEmpty) {
			const fixSelectionAction = new vscode.CodeAction(
				'Ollama: Fix Selected Code',
				vscode.CodeActionKind.QuickFix
			);

			fixSelectionAction.command = {
				command: 'ollama-code-review.fixSelection',
				title: 'Fix selected code',
				tooltip: 'Ask Ollama to fix issues in the selected code'
			};

			actions.push(fixSelectionAction);
		}

		return actions;
	}

	private _truncateMessage(message: string, maxLength: number = 40): string {
		const firstLine = message.split('\n')[0];
		if (firstLine.length <= maxLength) {
			return firstLine;
		}
		return firstLine.substring(0, maxLength - 3) + '...';
	}
}

/**
 * Stores applied fixes for tracking in review panel
 */
export interface AppliedFix {
	timestamp: Date;
	fileName: string;
	lineNumber: number;
	originalCode: string;
	fixedCode: string;
	issue: string;
}

/**
 * Track applied fixes across the session
 */
export class FixTracker {
	private static _instance: FixTracker;
	private _fixes: AppliedFix[] = [];
	private _onFixApplied = new vscode.EventEmitter<AppliedFix>();

	public readonly onFixApplied = this._onFixApplied.event;

	private constructor() { }

	public static getInstance(): FixTracker {
		if (!FixTracker._instance) {
			FixTracker._instance = new FixTracker();
		}
		return FixTracker._instance;
	}

	public recordFix(fix: AppliedFix): void {
		this._fixes.push(fix);
		this._onFixApplied.fire(fix);
	}

	public getRecentFixes(count: number = 10): AppliedFix[] {
		return this._fixes.slice(-count);
	}

	public clearFixes(): void {
		this._fixes = [];
	}

	public getFixCount(): number {
		return this._fixes.length;
	}
}

/**
 * Create a fix preview panel that shows the diff and allows applying
 */
export class FixPreviewPanel {
	public static currentPanel: FixPreviewPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];
	private _editor: vscode.TextEditor;
	private _range: vscode.Range;
	private _originalCode: string;
	private _fixedCode: string;
	private _explanation: string;
	private _issue: string;

	private constructor(
		panel: vscode.WebviewPanel,
		editor: vscode.TextEditor,
		range: vscode.Range,
		originalCode: string,
		fixedCode: string,
		explanation: string,
		issue: string,
		languageId: string
	) {
		this._panel = panel;
		this._editor = editor;
		this._range = range;
		this._originalCode = originalCode;
		this._fixedCode = fixedCode;
		this._explanation = explanation;
		this._issue = issue;

		this._panel.webview.html = this._getHtmlForWebview(originalCode, fixedCode, explanation, issue, languageId);

		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'applyFix':
						await this._applyFix();
						break;
					case 'dismiss':
						this.dispose();
						break;
				}
			},
			null,
			this._disposables
		);
	}

	public static createOrShow(
		editor: vscode.TextEditor,
		range: vscode.Range,
		originalCode: string,
		fixedCode: string,
		explanation: string,
		issue: string,
		languageId: string
	) {
		const column = vscode.ViewColumn.Beside;

		if (FixPreviewPanel.currentPanel) {
			FixPreviewPanel.currentPanel._panel.reveal(column);
			FixPreviewPanel.currentPanel._editor = editor;
			FixPreviewPanel.currentPanel._range = range;
			FixPreviewPanel.currentPanel._originalCode = originalCode;
			FixPreviewPanel.currentPanel._fixedCode = fixedCode;
			FixPreviewPanel.currentPanel._explanation = explanation;
			FixPreviewPanel.currentPanel._issue = issue;
			FixPreviewPanel.currentPanel._panel.webview.html =
				FixPreviewPanel.currentPanel._getHtmlForWebview(originalCode, fixedCode, explanation, issue, languageId);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'ollamaFix',
			'Fix Preview',
			column,
			{ enableScripts: true }
		);

		FixPreviewPanel.currentPanel = new FixPreviewPanel(
			panel,
			editor,
			range,
			originalCode,
			fixedCode,
			explanation,
			issue,
			languageId
		);
	}

	private async _applyFix() {
		try {
			await this._editor.edit(editBuilder => {
				editBuilder.replace(this._range, this._fixedCode);
			});

			// Record the fix
			const tracker = FixTracker.getInstance();
			tracker.recordFix({
				timestamp: new Date(),
				fileName: path.basename(this._editor.document.fileName),
				lineNumber: this._range.start.line + 1,
				originalCode: this._originalCode,
				fixedCode: this._fixedCode,
				issue: this._issue
			});

			vscode.window.showInformationMessage('Fix applied successfully!');
			this.dispose();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to apply fix: ${error}`);
		}
	}

	private _getHtmlForWebview(
		originalCode: string,
		fixedCode: string,
		explanation: string,
		issue: string,
		languageId: string
	): string {
		const escapedOriginal = escapeHtml(originalCode);
		const escapedFixed = escapeHtml(fixedCode);
		const escapedExplanation = escapeHtml(explanation);
		const escapedIssue = escapeHtml(issue);

		return `
<!DOCTYPE html>
<html>
<head>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		.header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 20px;
		}
		.header h2 {
			margin: 0;
			color: var(--vscode-foreground);
		}
		.issue-badge {
			background: var(--vscode-inputValidation-warningBackground);
			color: var(--vscode-inputValidation-warningForeground);
			padding: 6px 12px;
			border-radius: 4px;
			font-size: 12px;
			max-width: 300px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.actions {
			display: flex;
			gap: 8px;
			margin-bottom: 20px;
		}
		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 8px 16px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 13px;
		}
		button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		button.secondary:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}
		.diff-container {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 16px;
			margin-bottom: 24px;
		}
		.diff-section {
			flex: 1;
		}
		.diff-title {
			font-size: 12px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			margin-bottom: 8px;
			padding: 4px 8px;
			border-radius: 4px;
		}
		.diff-title.original {
			background: rgba(244, 67, 54, 0.2);
			color: #f44336;
		}
		.diff-title.fixed {
			background: rgba(76, 175, 80, 0.2);
			color: #4caf50;
		}
		.code-block {
			background: var(--vscode-textCodeBlock-background);
			border-radius: 6px;
			padding: 12px;
			overflow-x: auto;
			font-size: 13px;
		}
		.code-block pre {
			margin: 0;
		}
		.section {
			margin-bottom: 24px;
		}
		.section-title {
			font-size: 14px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 12px;
			padding-bottom: 8px;
			border-bottom: 1px solid var(--vscode-widget-border);
		}
		.explanation {
			line-height: 1.6;
		}
	</style>
</head>
<body>
	<div class="header">
		<h2>Fix Preview</h2>
		${issue ? `<span class="issue-badge" title="${escapedIssue}">${escapedIssue}</span>` : ''}
	</div>
	<div class="actions">
		<button onclick="applyFix()">Apply Fix</button>
		<button class="secondary" onclick="dismiss()">Dismiss</button>
	</div>
	<div class="diff-container">
		<div class="diff-section">
			<div class="diff-title original">Original</div>
			<div class="code-block">
				<pre><code class="language-${languageId}">${escapedOriginal}</code></pre>
			</div>
		</div>
		<div class="diff-section">
			<div class="diff-title fixed">Fixed</div>
			<div class="code-block">
				<pre><code class="language-${languageId}">${escapedFixed}</code></pre>
			</div>
		</div>
	</div>
	<div class="section">
		<div class="section-title">Explanation</div>
		<div class="explanation" id="explanation"></div>
	</div>
	<script>
		const vscode = acquireVsCodeApi();

		function applyFix() {
			vscode.postMessage({ command: 'applyFix' });
		}

		function dismiss() {
			vscode.postMessage({ command: 'dismiss' });
		}

		document.getElementById('explanation').innerHTML = marked.parse(\`${escapedExplanation.replace(/`/g, '\\`')}\`);
		document.querySelectorAll('pre code').forEach(hljs.highlightElement);
	</script>
</body>
</html>`;
	}

	public dispose() {
		FixPreviewPanel.currentPanel = undefined;
		this._panel.dispose();
		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}
