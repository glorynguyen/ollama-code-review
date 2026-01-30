import * as vscode from 'vscode';
import { extractSymbolName } from './types';

/**
 * Code Action Provider for "Add Documentation" functionality
 * Generates JSDoc/TSDoc for functions and classes
 */
export class AddDocumentationActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.RefactorRewrite
	];

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range
	): vscode.CodeAction[] | undefined {
		if (range.isEmpty) {
			return undefined;
		}

		const selectedText = document.getText(range);

		// Check if selection looks like a function or class
		const isDocumentable = /(?:async\s+)?(?:function|class)\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(|(?:public|private|protected)?\s*(?:async\s+)?\w+\s*\([^)]*\)\s*[:{]/.test(selectedText);

		if (!isDocumentable) {
			return undefined;
		}

		const docAction = new vscode.CodeAction(
			'Ollama: Add Documentation',
			vscode.CodeActionKind.RefactorRewrite
		);

		docAction.command = {
			command: 'ollama-code-review.addDocumentation',
			title: 'Generate documentation for this code',
			tooltip: 'Create JSDoc/TSDoc comments for the selected function or class'
		};

		return [docAction];
	}
}

/**
 * Panel for previewing and applying generated documentation
 */
export class DocumentationPreviewPanel {
	public static currentPanel: DocumentationPreviewPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];
	private _editor: vscode.TextEditor;
	private _range: vscode.Range;
	private _documentation: string;
	private _originalCode: string;

	private constructor(
		panel: vscode.WebviewPanel,
		editor: vscode.TextEditor,
		range: vscode.Range,
		documentation: string,
		originalCode: string,
		explanation: string,
		languageId: string
	) {
		this._panel = panel;
		this._editor = editor;
		this._range = range;
		this._documentation = documentation;
		this._originalCode = originalCode;

		this._panel.webview.html = this._getHtmlForWebview(documentation, originalCode, explanation, languageId);

		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'applyDocumentation':
						await this._applyDocumentation();
						break;
					case 'copyDocumentation':
						await this._copyDocumentation();
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
		documentation: string,
		originalCode: string,
		explanation: string,
		languageId: string
	) {
		const column = vscode.ViewColumn.Beside;

		if (DocumentationPreviewPanel.currentPanel) {
			DocumentationPreviewPanel.currentPanel._panel.reveal(column);
			DocumentationPreviewPanel.currentPanel._editor = editor;
			DocumentationPreviewPanel.currentPanel._range = range;
			DocumentationPreviewPanel.currentPanel._documentation = documentation;
			DocumentationPreviewPanel.currentPanel._originalCode = originalCode;
			DocumentationPreviewPanel.currentPanel._panel.webview.html =
				DocumentationPreviewPanel.currentPanel._getHtmlForWebview(documentation, originalCode, explanation, languageId);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'ollamaDocumentation',
			'Documentation Preview',
			column,
			{ enableScripts: true }
		);

		DocumentationPreviewPanel.currentPanel = new DocumentationPreviewPanel(
			panel,
			editor,
			range,
			documentation,
			originalCode,
			explanation,
			languageId
		);
	}

	private async _applyDocumentation() {
		try {
			// Insert documentation before the selected code
			const documentedCode = this._documentation + '\n' + this._originalCode;

			await this._editor.edit(editBuilder => {
				editBuilder.replace(this._range, documentedCode);
			});

			vscode.window.showInformationMessage('Documentation added successfully!');
			this.dispose();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to add documentation: ${error}`);
		}
	}

	private async _copyDocumentation() {
		await vscode.env.clipboard.writeText(this._documentation);
		vscode.window.showInformationMessage('Documentation copied to clipboard!');
	}

	private _getHtmlForWebview(
		documentation: string,
		originalCode: string,
		explanation: string,
		languageId: string
	): string {
		const escapedDoc = this._escapeHtml(documentation);
		const escapedCode = this._escapeHtml(originalCode);
		const escapedExplanation = this._escapeHtml(explanation);

		// Create combined preview
		const combinedCode = documentation + '\n' + originalCode;
		const escapedCombined = this._escapeHtml(combinedCode);

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
		.tabs {
			display: flex;
			border-bottom: 1px solid var(--vscode-widget-border);
			margin-bottom: 16px;
		}
		.tab {
			padding: 8px 16px;
			cursor: pointer;
			border-bottom: 2px solid transparent;
			color: var(--vscode-descriptionForeground);
		}
		.tab:hover {
			color: var(--vscode-foreground);
		}
		.tab.active {
			border-bottom-color: var(--vscode-focusBorder);
			color: var(--vscode-foreground);
		}
		.tab-content {
			display: none;
		}
		.tab-content.active {
			display: block;
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
		.code-block {
			background: var(--vscode-textCodeBlock-background);
			border-radius: 6px;
			padding: 16px;
			overflow-x: auto;
		}
		.code-block pre {
			margin: 0;
		}
		.doc-highlight {
			background: rgba(76, 175, 80, 0.1);
			border-left: 3px solid #4caf50;
			padding-left: 12px;
		}
		.explanation {
			line-height: 1.6;
		}
	</style>
</head>
<body>
	<div class="header">
		<h2>Generated Documentation</h2>
	</div>
	<div class="actions">
		<button onclick="applyDoc()">Apply Documentation</button>
		<button class="secondary" onclick="copyDoc()">Copy to Clipboard</button>
		<button class="secondary" onclick="dismiss()">Dismiss</button>
	</div>

	<div class="tabs">
		<div class="tab active" onclick="switchTab('preview')">Preview</div>
		<div class="tab" onclick="switchTab('doconly')">Documentation Only</div>
	</div>

	<div id="preview" class="tab-content active">
		<div class="section">
			<div class="section-title">Combined Preview</div>
			<div class="code-block">
				<pre><code class="language-${languageId}">${escapedCombined}</code></pre>
			</div>
		</div>
	</div>

	<div id="doconly" class="tab-content">
		<div class="section">
			<div class="section-title">Documentation</div>
			<div class="code-block doc-highlight">
				<pre><code class="language-${languageId}">${escapedDoc}</code></pre>
			</div>
		</div>
	</div>

	<div class="section">
		<div class="section-title">Explanation</div>
		<div class="explanation" id="explanation"></div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();

		function applyDoc() {
			vscode.postMessage({ command: 'applyDocumentation' });
		}

		function copyDoc() {
			vscode.postMessage({ command: 'copyDocumentation' });
		}

		function dismiss() {
			vscode.postMessage({ command: 'dismiss' });
		}

		function switchTab(tabId) {
			document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
			document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
			document.querySelector(\`.tab[onclick="switchTab('\${tabId}')"]\`).classList.add('active');
			document.getElementById(tabId).classList.add('active');
		}

		document.getElementById('explanation').innerHTML = marked.parse(\`${escapedExplanation.replace(/`/g, '\\`')}\`);
		document.querySelectorAll('pre code').forEach(hljs.highlightElement);
	</script>
</body>
</html>`;
	}

	private _escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	public dispose() {
		DocumentationPreviewPanel.currentPanel = undefined;
		this._panel.dispose();
		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}

/**
 * Determine documentation style based on language
 */
export function getDocumentationStyle(languageId: string): 'jsdoc' | 'tsdoc' | 'pydoc' | 'generic' {
	switch (languageId) {
		case 'typescript':
		case 'typescriptreact':
			return 'tsdoc';
		case 'javascript':
		case 'javascriptreact':
			return 'jsdoc';
		case 'python':
			return 'pydoc';
		default:
			return 'generic';
	}
}
