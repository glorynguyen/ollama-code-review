import * as vscode from 'vscode';
import axios from 'axios';
import { getOllamaModel } from './utils';
import { PerformanceMetrics } from './extension';

const CLAUDE_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MINIMAX_API_ENDPOINT = 'https://api.minimax.io/v1/text/chatcompletion_v2';

/**
 * Check if the model is a Claude model
 */
function isClaudeModel(model: string): boolean {
  return model.startsWith('claude-');
}

/**
 * Check if the model is a MiniMax model
 */
function isMiniMaxModel(model: string): boolean {
  return model.toLocaleLowerCase().startsWith('minimax-');
}

export class OllamaReviewPanel {
  public static currentPanel: OllamaReviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _context: vscode.ExtensionContext;
  private _conversationHistory: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = [];
  private _originalDiff: string;
  private _reviewContent: string;
  private _metrics: PerformanceMetrics | null = null;

  private constructor(panel: vscode.WebviewPanel, content: string, diff: string, context: vscode.ExtensionContext, metrics: PerformanceMetrics | null = null) {
    this._panel = panel;
    this._context = context;
    this._originalDiff = diff;
    this._reviewContent = content;
    this._metrics = metrics;

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
          case 'exportReview':
            await this._handleExport(message.format);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(content: string, diff: string, context: vscode.ExtensionContext, metrics: PerformanceMetrics | null = null) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (OllamaReviewPanel.currentPanel) {
      OllamaReviewPanel.currentPanel._panel.reveal(column);
      // Reset history for the new diff review
      OllamaReviewPanel.currentPanel._conversationHistory = [{ role: 'assistant', content }];
      OllamaReviewPanel.currentPanel._originalDiff = diff;
      OllamaReviewPanel.currentPanel._reviewContent = content;
      OllamaReviewPanel.currentPanel._metrics = metrics;
      // Refresh webview with new content and metrics
      OllamaReviewPanel.currentPanel._panel.webview.html = OllamaReviewPanel.currentPanel._getHtmlForWebview();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'ollamaReview', 'Ollama Code Review', column || vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    OllamaReviewPanel.currentPanel = new OllamaReviewPanel(panel, content, diff, context, metrics);
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
    const model = getOllamaModel(config);
    const selectedSkills = this._context.globalState.get<any[]>('selectedSkills', []);

    // Build skill guidelines from multiple selected skills
    let skillGuidelines = '';
    if (selectedSkills && selectedSkills.length > 0) {
      const skillContents = selectedSkills.map((skill, index) =>
        `### Skill ${index + 1}: ${skill.name}\n${skill.content}`
      ).join('\n\n');
      skillGuidelines = `\n\nReview Guidelines (${selectedSkills.length} skill(s) applied):\n${skillContents}`;
    }

    const systemContent = `You are an expert code reviewer. You are discussing this code diff:\n\n${this._originalDiff}${skillGuidelines}`;

    // Use Claude API if a Claude model is selected
    if (isClaudeModel(model)) {
      const apiKey = config.get<string>('claudeApiKey', '');
      if (!apiKey) {
        throw new Error('Claude API key is not configured. Please set it in Settings > Ollama Code Review > Claude Api Key');
      }

      // Claude uses a different message format - system goes in a separate field
      const claudeMessages = this._conversationHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));

      const response = await axios.post(
        CLAUDE_API_ENDPOINT,
        {
          model: model,
          max_tokens: 8192,
          system: systemContent,
          messages: claudeMessages,
          temperature: config.get('temperature', 0)
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          }
        }
      );

      const content = response.data.content;
      if (Array.isArray(content) && content.length > 0) {
        return content.map((block: { type: string; text: string }) =>
          block.type === 'text' ? block.text : ''
        ).join('').trim();
      }
      return '';
    }

    // Use MiniMax API if a MiniMax model is selected
    if (isMiniMaxModel(model)) {
      const apiKey = config.get<string>('minimaxApiKey', '');
      if (!apiKey) {
        throw new Error('MiniMax API key is not configured. Please set it in Settings > Ollama Code Review > Minimax Api Key');
      }

      const minimaxModel = model;

      const minimaxMessages = [
        {
          role: 'system' as const,
          content: systemContent
        },
        ...this._conversationHistory.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }))
      ];

      const response = await axios.post(
        MINIMAX_API_ENDPOINT,
        {
          model: minimaxModel,
          messages: minimaxMessages,
          temperature: config.get('temperature', 0),
          max_tokens: 8192
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        }
      );

      const choices = response.data.choices;
      if (Array.isArray(choices) && choices.length > 0 && choices[0].message) {
        return choices[0].message.content?.trim() || '';
      }
      return '';
    }

    // Otherwise use Ollama API
    const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate').replace('/generate', '/chat');

    // System message provides the context of the code being reviewed
    const messages = [
      {
        role: 'system',
        content: systemContent
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

  private async _handleExport(format: string) {
    const content = this._reviewContent;
    switch (format) {
      case 'clipboard':
        await vscode.env.clipboard.writeText(content);
        vscode.window.showInformationMessage('Review copied to clipboard!');
        break;
      case 'markdown':
        await this._saveAsMarkdown(content);
        break;
      case 'prDescription':
        await vscode.env.clipboard.writeText(this._formatAsPrDescription(content));
        vscode.window.showInformationMessage('PR description copied to clipboard!');
        break;
      case 'gist':
        await this._createGist(content);
        break;
    }
  }

  private async _saveAsMarkdown(content: string) {
    const timestamp = new Date().toISOString().split('T')[0];
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`code-review-${timestamp}.md`),
      filters: { 'Markdown': ['md'] }
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
      vscode.window.showInformationMessage(`Review saved to ${uri.fsPath}`);
    }
  }

  private _formatAsPrDescription(content: string): string {
    const config = vscode.workspace.getConfiguration('ollama-code-review');
    const model = getOllamaModel(config);
    const timestamp = new Date().toLocaleDateString();
    return `## AI Code Review\n\n> Generated on ${timestamp} by [Ollama Code Review](https://github.com/glorynguyen/ollama-code-review) using \`${model}\`\n\n---\n\n${content}`;
  }

  private async _createGist(content: string) {
    const config = vscode.workspace.getConfiguration('ollama-code-review');
    const token = config.get<string>('github.gistToken', '');
    if (!token) {
      const action = await vscode.window.showErrorMessage(
        'GitHub token required to create a Gist. Set it in Settings > Ollama Code Review > GitHub Gist Token.',
        'Open Settings'
      );
      if (action === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'ollama-code-review.github.gistToken');
      }
      return;
    }
    try {
      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: token });
      const timestamp = new Date().toISOString().split('T')[0];
      const response = await octokit.gists.create({
        description: `Code Review - ${timestamp}`,
        public: false,
        files: {
          [`code-review-${timestamp}.md`]: { content }
        }
      });
      const gistUrl = response.data.html_url!;
      const action = await vscode.window.showInformationMessage(
        'Gist created successfully!',
        'Open in Browser', 'Copy URL'
      );
      if (action === 'Open in Browser') {
        vscode.env.openExternal(vscode.Uri.parse(gistUrl));
      } else if (action === 'Copy URL') {
        await vscode.env.clipboard.writeText(gistUrl);
      }
    } catch (error) {
      vscode.window.showErrorMessage('Failed to create Gist: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  private _getHtmlForWebview() {
    // Pass the current history as a JSON string for the very first render
    const initialData = JSON.stringify(this._conversationHistory);
    const metricsData = JSON.stringify(this._metrics);

    return `
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <style>
        body { font-family: var(--vscode-font-family); display: flex; flex-direction: column; height: 100vh; margin: 0; }
        .toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 6px 14px; background: var(--vscode-editorGroupHeader-tabsBackground, #1e1e1e); border-bottom: 1px solid #333; flex-shrink: 0; }
        .export-btn { display: inline-flex; align-items: center; gap: 4px; background: var(--vscode-button-secondaryBackground, #3a3a3a); color: var(--vscode-button-secondaryForeground, #ccc); border: 1px solid #444; border-radius: 3px; padding: 3px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; }
        .export-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #4a4a4a); color: var(--vscode-foreground, #fff); }
        .container { flex: 1; overflow-y: auto; padding: 20px; }
        .message { margin-bottom: 20px; padding: 10px; border-radius: 5px; }
        .assistant { background: var(--vscode-editor-background); border-left: 4px solid cyan; }
        .user { background: var(--vscode-input-background); border-left: 4px solid orange; }
        .input-area { padding: 20px; border-top: 1px solid #333; display: flex; gap: 10px; }
        input { flex: 1; background: #222; color: white; border: 1px solid #444; padding: 8px; }
        #loading { display: none; color: gray; margin-left: 20px; }

        /* Performance Metrics Styles */
        .metrics-panel {
            background: var(--vscode-editor-background);
            border-top: 1px solid #333;
            padding: 12px 20px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #888);
        }
        .metrics-header {
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        .metrics-header:hover { color: var(--vscode-foreground, #ccc); }
        .metrics-toggle {
            margin-right: 8px;
            transition: transform 0.2s;
        }
        .metrics-toggle.collapsed { transform: rotate(-90deg); }
        .metrics-title { font-weight: 600; }
        .metrics-content {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 8px 16px;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #333;
        }
        .metrics-content.hidden { display: none; }
        .metric-item {
            display: flex;
            flex-direction: column;
        }
        .metric-label {
            color: var(--vscode-descriptionForeground, #666);
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .metric-value {
            color: var(--vscode-foreground, #ccc);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 13px;
        }
        .metric-value.highlight { color: #4ec9b0; }
        .metric-value.warning { color: #dcdcaa; }
        .active-model-badge {
            display: inline-flex;
            align-items: center;
            background: rgba(78, 201, 176, 0.15);
            color: #4ec9b0;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            margin-left: auto;
        }
        .active-model-badge::before {
            content: '';
            width: 6px;
            height: 6px;
            background: #4ec9b0;
            border-radius: 50%;
            margin-right: 6px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button class="export-btn" onclick="exportReview('clipboard')" title="Copy review to clipboard">📋 Copy</button>
        <button class="export-btn" onclick="exportReview('markdown')" title="Save as Markdown file">💾 Markdown</button>
        <button class="export-btn" onclick="exportReview('prDescription')" title="Copy as PR description">📄 PR Desc</button>
        <button class="export-btn" onclick="exportReview('gist')" title="Create GitHub Gist">🔗 Gist</button>
    </div>
    <div class="container" id="chat"></div>
    <div id="loading">Thinking...</div>
    <div class="input-area">
        <input type="text" id="in" placeholder="Ask a question..." />
        <button id="send">Send</button>
    </div>
    <div class="metrics-panel" id="metrics-panel"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let chatHistory = ${initialData};
        let metrics = ${metricsData};
        let metricsExpanded = true;

        function formatBytes(bytes) {
            if (!bytes) return 'N/A';
            const gb = bytes / (1024 * 1024 * 1024);
            if (gb >= 1) return gb.toFixed(2) + ' GB';
            const mb = bytes / (1024 * 1024);
            return mb.toFixed(1) + ' MB';
        }

        function formatDuration(seconds) {
            if (!seconds) return 'N/A';
            if (seconds < 1) return (seconds * 1000).toFixed(0) + ' ms';
            if (seconds < 60) return seconds.toFixed(2) + ' s';
            const mins = Math.floor(seconds / 60);
            const secs = (seconds % 60).toFixed(1);
            return mins + 'm ' + secs + 's';
        }

        function formatTokensPerSec(tps) {
            if (!tps) return 'N/A';
            return tps.toFixed(1) + ' tok/s';
        }

        function renderMetrics() {
            const panel = document.getElementById('metrics-panel');
            if (!metrics) {
                panel.style.display = 'none';
                return;
            }
            panel.style.display = 'block';

            let metricsHtml = [];

            // Provider/Model info
            if (metrics.provider || metrics.model) {
                const provider = metrics.provider ? metrics.provider.charAt(0).toUpperCase() + metrics.provider.slice(1) : '';
                metricsHtml.push('<div class="metric-item"><span class="metric-label">Model</span><span class="metric-value">' + (metrics.model || 'Unknown') + '</span></div>');
            }

            // Active review profile
            if (metrics.activeProfile && metrics.activeProfile !== 'general') {
                metricsHtml.push('<div class="metric-item"><span class="metric-label">Profile</span><span class="metric-value highlight">' + metrics.activeProfile + '</span></div>');
            }

            // Ollama-specific metrics
            if (metrics.provider === 'ollama') {
                if (metrics.totalDurationSeconds) {
                    metricsHtml.push('<div class="metric-item"><span class="metric-label">Total Duration</span><span class="metric-value">' + formatDuration(metrics.totalDurationSeconds) + '</span></div>');
                }
                if (metrics.tokensPerSecond) {
                    metricsHtml.push('<div class="metric-item"><span class="metric-label">Generation Speed</span><span class="metric-value highlight">' + formatTokensPerSec(metrics.tokensPerSecond) + '</span></div>');
                }
                if (metrics.loadDuration) {
                    const loadSec = metrics.loadDuration / 1e9;
                    metricsHtml.push('<div class="metric-item"><span class="metric-label">Model Load</span><span class="metric-value">' + formatDuration(loadSec) + '</span></div>');
                }
            }

            // Token counts (common across providers)
            if (metrics.promptEvalCount) {
                metricsHtml.push('<div class="metric-item"><span class="metric-label">Input Tokens</span><span class="metric-value">' + metrics.promptEvalCount.toLocaleString() + '</span></div>');
            }
            if (metrics.evalCount) {
                metricsHtml.push('<div class="metric-item"><span class="metric-label">Output Tokens</span><span class="metric-value">' + metrics.evalCount.toLocaleString() + '</span></div>');
            }

            // Hugging Face rate limit info
            if (metrics.provider === 'huggingface') {
                if (metrics.hfRateLimitRemaining !== undefined) {
                    const warningClass = metrics.hfRateLimitRemaining < 10 ? 'warning' : '';
                    metricsHtml.push('<div class="metric-item"><span class="metric-label">HF Quota Remaining</span><span class="metric-value ' + warningClass + '">' + metrics.hfRateLimitRemaining + '</span></div>');
                }
                if (metrics.hfRateLimitReset) {
                    const resetDate = new Date(metrics.hfRateLimitReset * 1000);
                    metricsHtml.push('<div class="metric-item"><span class="metric-label">Quota Resets</span><span class="metric-value">' + resetDate.toLocaleTimeString() + '</span></div>');
                }
            }

            // Active model info (Ollama)
            let activeModelBadge = '';
            if (metrics.activeModel) {
                activeModelBadge = '<span class="active-model-badge">In VRAM: ' + metrics.activeModel.name + '</span>';
                if (metrics.activeModel.sizeVram) {
                    metricsHtml.push('<div class="metric-item"><span class="metric-label">VRAM Usage</span><span class="metric-value highlight">' + formatBytes(metrics.activeModel.sizeVram) + '</span></div>');
                }
            }

            const toggleClass = metricsExpanded ? '' : 'collapsed';
            const contentClass = metricsExpanded ? '' : 'hidden';

            panel.innerHTML = \`
                <div class="metrics-header" onclick="toggleMetrics()">
                    <span class="metrics-toggle \${toggleClass}">▼</span>
                    <span class="metrics-title">System Info</span>
                    \${activeModelBadge}
                </div>
                <div class="metrics-content \${contentClass}" id="metrics-content">
                    \${metricsHtml.join('')}
                </div>
            \`;
        }

        window.toggleMetrics = function() {
            metricsExpanded = !metricsExpanded;
            renderMetrics();
        };

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

        window.exportReview = function(format) {
            vscode.postMessage({ command: 'exportReview', format: format });
        };

        document.getElementById('send').onclick = () => {
            const val = document.getElementById('in').value;
            if(val) {
                vscode.postMessage({ command: 'sendMessage', text: val });
                document.getElementById('in').value = '';
                document.getElementById('in').disabled = true;
            }
        };

        // Handle Enter key to send message
        document.getElementById('in').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('send').click();
            }
        });

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
        renderMetrics(); // Render metrics panel
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