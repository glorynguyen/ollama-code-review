import * as vscode from 'vscode';
import axios from 'axios';

export class OllamaReviewPanel {
  public static currentPanel: OllamaReviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _context: vscode.ExtensionContext;
  private _conversationHistory: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];
  private _originalDiff: string;

  private constructor(panel: vscode.WebviewPanel, content: string, diff: string, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._context = context;
    this._originalDiff = diff;

    this._conversationHistory.push({ role: 'assistant', content: content });

    // 1. Set the initial HTML structure
    this._panel.webview.html = this._getHtmlForWebview();
    
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'sendMessage':
            await this._handleUserMessage(message.text);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(content: string, diff: string, context: vscode.ExtensionContext) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (OllamaReviewPanel.currentPanel) {
      OllamaReviewPanel.currentPanel._panel.reveal(column);
      // Reset history for the new diff review
      OllamaReviewPanel.currentPanel._conversationHistory = [{ role: 'assistant', content }];
      OllamaReviewPanel.currentPanel._originalDiff = diff;
      // Tell webview to refresh messages
      OllamaReviewPanel.currentPanel._syncMessages();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'ollamaReview', 'Ollama Code Review', column || vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    OllamaReviewPanel.currentPanel = new OllamaReviewPanel(panel, content, diff, context);
  }

  private _syncMessages() {
    this._panel.webview.postMessage({ 
      command: 'updateMessages', 
      messages: this._conversationHistory 
    });
  }

  private async _handleUserMessage(userMessage: string) {
    this._conversationHistory.push({ role: 'user', content: userMessage });
    this._syncMessages();
    this._panel.webview.postMessage({ command: 'showLoading' });

    try {
      const response = await this._getFollowUpResponse();
      this._conversationHistory.push({ role: 'assistant', content: response });
      this._syncMessages();
      this._panel.webview.postMessage({ command: 'hideLoading' });
    } catch (error) {
      this._panel.webview.postMessage({
        command: 'showError',
        error: error instanceof Error ? error.message : 'Failed to get response'
      });
    }
  }

  private async _getFollowUpResponse(): Promise<string> {
    const config = vscode.workspace.getConfiguration('ollama-code-review');
    const model = config.get<string>('model', 'qwen2.5-coder:14b-instruct-q4_0');
    const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate').replace('/generate', '/chat');

    const selectedSkill = this._context.globalState.get<any>('selectedSkill');
    
    // System message provides the context of the code being reviewed
    const messages = [
      {
        role: 'system',
        content: `You are an expert code reviewer. You are discussing this code diff:\n\n${this._originalDiff}${selectedSkill ? `\n\nReview Guidelines: ${selectedSkill.content}` : ''}`
      },
      ...this._conversationHistory
    ];

    const response = await axios.post(endpoint, {
      model: model,
      messages: messages,
      stream: false,
      options: { temperature: config.get('temperature', 0) }
    });

    return response.data.message.content.trim();
  }

  private _getHtmlForWebview() {
    // Pass the current history as a JSON string for the very first render
    const initialData = JSON.stringify(this._conversationHistory);

    return `
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <style>
        body { font-family: var(--vscode-font-family); display: flex; flex-direction: column; height: 100vh; margin: 0; }
        .container { flex: 1; overflow-y: auto; padding: 20px; }
        .message { margin-bottom: 20px; padding: 10px; border-radius: 5px; }
        .assistant { background: var(--vscode-editor-background); border-left: 4px solid cyan; }
        .user { background: var(--vscode-input-background); border-left: 4px solid orange; }
        .input-area { padding: 20px; border-top: 1px solid #333; display: flex; gap: 10px; }
        input { flex: 1; background: #222; color: white; border: 1px solid #444; padding: 8px; }
        #loading { display: none; color: gray; margin-left: 20px; }
    </style>
</head>
<body>
    <div class="container" id="chat"></div>
    <div id="loading">Thinking...</div>
    <div class="input-area">
        <input type="text" id="in" placeholder="Ask a question..." />
        <button id="send">Send</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let chatHistory = ${initialData};

        function render() {
            const container = document.getElementById('chat');
            container.innerHTML = chatHistory.map(m => \`
                <div class="message \${m.role}">
                    <strong>\${m.role === 'user' ? 'You' : 'Ollama'}</strong>
                    <div>\${marked.parse(m.content)}</div>
                </div>
            \`).join('');
            document.querySelectorAll('pre code').forEach(hljs.highlightElement);
            container.scrollTop = container.scrollHeight;
        }

        document.getElementById('send').onclick = () => {
            const val = document.getElementById('in').value;
            if(val) {
                vscode.postMessage({ command: 'sendMessage', text: val });
                document.getElementById('in').value = '';
                document.getElementById('in').disabled = true;
            }
        };

        // 5. This listener is now correctly wired to the extension's _syncMessages()
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'updateMessages':
                    chatHistory = msg.messages;
                    render();
                    break;
                case 'showLoading':
                    document.getElementById('loading').style.display = 'block';
                    break;
                case 'hideLoading':
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('in').disabled = false;
                    document.getElementById('in').focus();
                    break;
            }
        });

        render(); // Initial render
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