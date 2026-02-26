import * as vscode from 'vscode';
import { getOllamaModel, escapeHtml } from '../utils';
import { type ProviderRequestContext, providerRegistry } from '../providers';
import { DiffDecorator } from './diffDecorator';

/**
 * F-024: Inline Edit Mode
 *
 * Lets users highlight code, describe a change in natural language, and have the
 * AI stream back the replacement with a side-by-side diff preview before applying.
 */

const INLINE_EDIT_PROMPT_TEMPLATE = `You are an expert code editor. Given the following code and a description of the desired change, generate only the modified code.

IMPORTANT RULES:
- Output ONLY the modified code, with NO explanations, NO markdown code fences, and NO commentary
- Preserve the existing indentation and surrounding code style exactly
- Make only the specific change described — do not refactor unrelated logic

Code to modify:
\`\`\`
{originalCode}
\`\`\`

Change description: {description}

Output the modified code directly (no fences, no explanation):`;

/**
 * Preview panel for Inline Edit Mode. Shows original vs AI-generated code side-by-side,
 * streams the generation in real-time, and lets the user Accept or Reject.
 */
export class InlineEditPreviewPanel {
	public static currentPanel: InlineEditPreviewPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private readonly _editor: vscode.TextEditor;
	private readonly _range: vscode.Range;
	private readonly _originalCode: string;
	private readonly _decorator: DiffDecorator;
	private _generatedCode = '';
	private _isStreaming = false;
	private _disposables: vscode.Disposable[] = [];

	private constructor(
		panel: vscode.WebviewPanel,
		editor: vscode.TextEditor,
		range: vscode.Range,
		originalCode: string,
	) {
		this._panel = panel;
		this._editor = editor;
		this._range = range;
		this._originalCode = originalCode;
		this._decorator = new DiffDecorator(editor, range);

		this._panel.webview.html = this._getHtml('', true);
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
		this._panel.webview.onDidReceiveMessage(
			(message: { command: string }) => this._handleMessage(message),
			null,
			this._disposables,
		);
	}

	public static createOrShow(
		editor: vscode.TextEditor,
		range: vscode.Range,
		originalCode: string,
	): InlineEditPreviewPanel {
		const column = editor.viewColumn
			? editor.viewColumn + 1
			: vscode.ViewColumn.Beside;

		if (InlineEditPreviewPanel.currentPanel) {
			InlineEditPreviewPanel.currentPanel.dispose();
		}

		const panel = vscode.window.createWebviewPanel(
			'ollamaInlineEdit',
			'Inline Edit Preview',
			column,
			{ enableScripts: true, retainContextWhenHidden: false },
		);

		InlineEditPreviewPanel.currentPanel = new InlineEditPreviewPanel(
			panel,
			editor,
			range,
			originalCode,
		);

		return InlineEditPreviewPanel.currentPanel;
	}

	/** Called for each streaming chunk from the AI. */
	public pushChunk(chunk: string): void {
		this._isStreaming = true;
		this._generatedCode += chunk;
		this._panel.webview.postMessage({ command: 'chunk', text: chunk });
	}

	/** Called when streaming is complete. */
	public finalizeStream(): void {
		this._isStreaming = false;
		this._panel.webview.postMessage({ command: 'done', fullText: this._generatedCode });
	}

	/** Called on AI error. */
	public showError(message: string): void {
		this._isStreaming = false;
		this._panel.webview.postMessage({ command: 'error', message });
		this._decorator.clearAll();
	}

	private async _handleMessage(message: { command: string }): Promise<void> {
		switch (message.command) {
			case 'accept':
				await this._applyEdit();
				break;
			case 'reject':
				this.dispose();
				vscode.window.showInformationMessage('Inline edit rejected — original code preserved.');
				break;
		}
	}

	private async _applyEdit(): Promise<void> {
		try {
			// Strip any accidental markdown fences the model might have added
			let code = this._generatedCode.trim();
			const fenceMatch = code.match(/^```[\w]*\n?([\s\S]*?)```\s*$/);
			if (fenceMatch) {
				code = fenceMatch[1];
			}

			await this._editor.edit((builder: vscode.TextEditorEdit) => {
				builder.replace(this._range, code);
			});

			vscode.window.showInformationMessage('Inline edit applied.');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to apply edit: ${err}`);
		} finally {
			this.dispose();
		}
	}

	public dispose(): void {
		InlineEditPreviewPanel.currentPanel = undefined;
		this._decorator.dispose();
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables = [];
		this._panel.dispose();
	}

	private _getHtml(initialGenerated: string, streaming: boolean): string {
		const escapedOriginal = escapeHtml(this._originalCode);
		const escapedGenerated = escapeHtml(initialGenerated);

		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Inline Edit Preview</title>
<style>
  :root {
    --border: var(--vscode-panel-border, #3c3c3c);
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --header-bg: var(--vscode-sideBarSectionHeader-background, #252526);
    --removed-bg: var(--vscode-diffEditor-removedLineBackground, rgba(255,0,0,0.12));
    --added-bg: var(--vscode-diffEditor-insertedLineBackground, rgba(0,255,0,0.1));
    --btn-accept: var(--vscode-button-background, #0e639c);
    --btn-accept-fg: var(--vscode-button-foreground, #fff);
    --btn-reject-bg: var(--vscode-button-secondaryBackground, #3a3d41);
    --btn-reject-fg: var(--vscode-button-secondaryForeground, #ccc);
    --font: var(--vscode-editor-font-family, 'Consolas', monospace);
    --font-size: var(--vscode-editor-font-size, 13px);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .toolbar {
    background: var(--header-bg);
    border-bottom: 1px solid var(--border);
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .toolbar h2 { font-size: 13px; font-weight: 600; flex: 1; }
  .toolbar .status {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
  }
  .diff-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    flex: 1;
    overflow: hidden;
    border-top: 1px solid var(--border);
  }
  .pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--border);
  }
  .pane:last-child { border-right: none; }
  .pane-header {
    background: var(--header-bg);
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground, #888);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .pane-header.removed { color: var(--vscode-editorError-foreground, #f48771); }
  .pane-header.added   { color: var(--vscode-gitDecoration-addedResourceForeground, #81c784); }
  .code-scroll {
    overflow: auto;
    flex: 1;
  }
  pre {
    font-family: var(--font);
    font-size: var(--font-size);
    line-height: 1.5;
    padding: 12px;
    white-space: pre;
    min-height: 100%;
  }
  .removed-pane pre { background: var(--removed-bg); }
  .added-pane  pre { background: var(--added-bg); }
  .cursor::after {
    content: '▋';
    animation: blink 0.8s step-end infinite;
    color: var(--vscode-editorCursor-foreground, #aeafad);
  }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .actions {
    background: var(--header-bg);
    border-top: 1px solid var(--border);
    padding: 8px 12px;
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  button {
    padding: 6px 16px;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  #btn-accept {
    background: var(--btn-accept);
    color: var(--btn-accept-fg);
  }
  #btn-reject {
    background: var(--btn-reject-bg);
    color: var(--btn-reject-fg);
  }
  #btn-accept:hover:not(:disabled) { filter: brightness(1.15); }
  #btn-reject:hover:not(:disabled) { filter: brightness(1.15); }
</style>
</head>
<body>
<div class="toolbar">
  <h2>Inline Edit Preview</h2>
  <span class="status" id="status">${streaming ? 'Generating…' : 'Review the changes below'}</span>
</div>
<div class="diff-container">
  <div class="pane removed-pane">
    <div class="pane-header removed">Original</div>
    <div class="code-scroll"><pre id="original">${escapedOriginal}</pre></div>
  </div>
  <div class="pane added-pane">
    <div class="pane-header added">Generated</div>
    <div class="code-scroll"><pre id="generated" class="${streaming ? 'cursor' : ''}">${escapedGenerated}</pre></div>
  </div>
</div>
<div class="actions">
  <button id="btn-accept" ${streaming ? 'disabled' : ''}>Accept</button>
  <button id="btn-reject">Reject</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const genEl = document.getElementById('generated');
  const statusEl = document.getElementById('status');
  const acceptBtn = document.getElementById('btn-accept');

  let fullText = '';

  window.addEventListener('message', ({ data: msg }) => {
    switch (msg.command) {
      case 'chunk':
        fullText += msg.text;
        genEl.textContent = fullText;
        genEl.classList.add('cursor');
        genEl.parentElement.scrollTop = genEl.parentElement.scrollHeight;
        break;
      case 'done':
        fullText = msg.fullText;
        genEl.textContent = fullText;
        genEl.classList.remove('cursor');
        statusEl.textContent = 'Review the changes below';
        acceptBtn.disabled = false;
        break;
      case 'error':
        genEl.classList.remove('cursor');
        statusEl.textContent = 'Error: ' + msg.message;
        genEl.textContent = msg.message;
        break;
    }
  });

  document.getElementById('btn-accept').addEventListener('click', () => vscode.postMessage({ command: 'accept' }));
  document.getElementById('btn-reject').addEventListener('click', () => vscode.postMessage({ command: 'reject' }));
</script>
</body>
</html>`;
	}
}

/**
 * Entry point for the Inline Edit command.
 * Called by the registered `ollama-code-review.inlineEdit` command.
 */
export async function executeInlineEdit(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('Inline Edit: No active editor found.');
		return;
	}

	// Use selection or current line if nothing is selected
	let range = editor.selection;
	if (range.isEmpty) {
		const line = editor.document.lineAt(editor.selection.active.line);
		range = new vscode.Selection(line.range.start, line.range.end);
	}

	const originalCode = editor.document.getText(range);
	if (!originalCode.trim()) {
		vscode.window.showWarningMessage('Inline Edit: Select some code first.');
		return;
	}

	// Ask the user what change to make
	const description = await vscode.window.showInputBox({
		prompt: 'Describe the change you want to make',
		placeHolder: 'e.g. Convert to async/await, add error handling, rename variable to camelCase…',
		ignoreFocusOut: true,
	});

	if (!description || !description.trim()) {
		return; // User cancelled
	}

	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0);

	const prompt = INLINE_EDIT_PROMPT_TEMPLATE
		.replace('{originalCode}', originalCode)
		.replace('{description}', description.trim());

	// Open preview panel and decorate original code
	const previewPanel = InlineEditPreviewPanel.createOrShow(editor, range, originalCode);
	const decorator = new DiffDecorator(editor, range);
	decorator.markOriginalAsRemoved();

	const requestContext: ProviderRequestContext = {
		config,
		model,
		endpoint,
		temperature,
	};

	try {
		const provider = providerRegistry.resolve(model);

		if (provider.supportsStreaming()) {
			await provider.stream(prompt, requestContext, {
				onChunk: (chunk: string) => previewPanel.pushChunk(chunk),
			});
			previewPanel.finalizeStream();
		} else {
			// Non-streaming: generate then emit as single chunk
			const result = await provider.generate(prompt, requestContext);
			previewPanel.pushChunk(result);
			previewPanel.finalizeStream();
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		previewPanel.showError(message);
		decorator.clearAll();
		vscode.window.showErrorMessage(`Inline Edit failed: ${message}`);
	} finally {
		decorator.clearAll();
	}
}
