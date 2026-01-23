import * as vscode from 'vscode';

export class OllamaReviewPanel {
  public static currentPanel: OllamaReviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, content: string) {
    this._panel = panel;
    this._update(content);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static createOrShow(content: string) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
    if (OllamaReviewPanel.currentPanel) {
      OllamaReviewPanel.currentPanel._panel.reveal(column);
      OllamaReviewPanel.currentPanel._update(content);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'ollamaReview',
      'Ollama Code Review Output',
      column || vscode.ViewColumn.One,
      { enableScripts: true }
    );
    OllamaReviewPanel.currentPanel = new OllamaReviewPanel(panel, content);
  }

  private _update(content: string) {
    this._panel.webview.html = this._getHtmlForWebview(content);
  }

  private _getHtmlForWebview(content: string) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); padding: 20px; line-height: 1.6; }
pre { background: #1e1e1e; padding: 15px; border-radius: 5px; overflow-x: auto; }
code { font-family: var(--vscode-editor-font-family); }
h1, h2, h3 { color: var(--vscode-symbolIcon-keywordForeground); }
.container { max-width: 800px; margin: 0 auto; }
</style>
</head>
<body>
<div class="container">
<button id="copyButton" style="margin-bottom: 10px;">Copy Review</button>
<div id="content"></div>
</div>
<script>
document.getElementById('copyButton').addEventListener('click', () => {
  navigator.clipboard.writeText(document.body.innerText);
});
const rawMarkdown = \`${content.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
document.getElementById('content').innerHTML = marked.parse(rawMarkdown);
hljs.highlightAll();
</script>
</body>
</html>`;
  }

  public dispose() {
    OllamaReviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }
}