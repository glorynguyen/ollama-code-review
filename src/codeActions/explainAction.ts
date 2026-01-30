import * as vscode from 'vscode';

/**
 * Code Action Provider for "Explain This Code" functionality
 * Shows a detailed explanation of the selected code in a panel
 */
export class ExplainCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.RefactorExtract
	];

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range
	): vscode.CodeAction[] | undefined {
		if (range.isEmpty) {
			return undefined;
		}

		const explainAction = new vscode.CodeAction(
			'Ollama: Explain This Code',
			vscode.CodeActionKind.RefactorExtract
		);

		explainAction.command = {
			command: 'ollama-code-review.explainCode',
			title: 'Explain the selected code',
			tooltip: 'Get a detailed explanation of what this code does'
		};

		return [explainAction];
	}
}

/**
 * Panel for displaying code explanations
 */
export class ExplainCodePanel {
	public static currentPanel: ExplainCodePanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];

	private constructor(panel: vscode.WebviewPanel, code: string, explanation: string, languageId: string) {
		this._panel = panel;
		this._panel.webview.html = this._getHtmlForWebview(code, explanation, languageId);
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
	}

	public static createOrShow(code: string, explanation: string, languageId: string) {
		const column = vscode.ViewColumn.Beside;

		if (ExplainCodePanel.currentPanel) {
			ExplainCodePanel.currentPanel._panel.reveal(column);
			ExplainCodePanel.currentPanel._panel.webview.html =
				ExplainCodePanel.currentPanel._getHtmlForWebview(code, explanation, languageId);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'ollamaExplain',
			'Code Explanation',
			column,
			{ enableScripts: true }
		);

		ExplainCodePanel.currentPanel = new ExplainCodePanel(panel, code, explanation, languageId);
	}

	private _getHtmlForWebview(code: string, explanation: string, languageId: string): string {
		const escapedCode = this._escapeHtml(code);
		const escapedExplanation = this._escapeHtml(explanation);

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
		.explanation {
			line-height: 1.6;
		}
		.explanation h1, .explanation h2, .explanation h3 {
			margin-top: 16px;
			margin-bottom: 8px;
		}
		.explanation ul, .explanation ol {
			padding-left: 24px;
		}
		.explanation li {
			margin-bottom: 4px;
		}
		.explanation code {
			background: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
			font-family: var(--vscode-editor-font-family);
		}
	</style>
</head>
<body>
	<div class="section">
		<div class="section-title">Selected Code</div>
		<div class="code-block">
			<pre><code class="language-${languageId}">${escapedCode}</code></pre>
		</div>
	</div>
	<div class="section">
		<div class="section-title">Explanation</div>
		<div class="explanation" id="explanation"></div>
	</div>
	<script>
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
		ExplainCodePanel.currentPanel = undefined;
		this._panel.dispose();
		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}
