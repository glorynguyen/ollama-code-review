import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { callAIProvider } from '../commands/aiActions';
import {
	isClaudeModel,
	isGeminiModel,
	isGlmModel,
	isHuggingFaceModel,
	isMiniMaxModel,
	isMistralModel,
	isOpenAICompatibleModel,
	streamClaudeAPI,
	streamOllamaAPI,
	streamOpenAICompatibleAPI,
} from '../commands/providerClients';
import { getOllamaModel } from '../utils';
import { ConversationManager } from './conversationManager';
import { toModelLimitChatMessage } from './modelErrorUtils';
import type { ChatMessage, Conversation, WebviewInboundMessage, WebviewOutboundMessage } from './types';

interface AIProvider {
	sendMessage(prompt: string, onChunk: (chunk: string) => void): Promise<string>;
}

const execFileAsync = promisify(execFile);
const STAGED_DIFF_MAX_CHARS = 20000;
const SUPPORTED_CHAT_COMMANDS = ['/staged', '/help'] as const;

interface StagedDiffContext {
	content: string;
	hasDiff: boolean;
	truncated: boolean;
}

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'ai-review.chat-sidebar';

	private static instance: ChatSidebarProvider | undefined;

	private view: vscode.WebviewView | undefined;
	private lastInjectedContext = '';

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly conversationManager: ConversationManager,
	) {
		ChatSidebarProvider.instance = this;
	}

	public static getInstance(): ChatSidebarProvider | undefined {
		return ChatSidebarProvider.instance;
	}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (message: WebviewInboundMessage) => {
			switch (message.type) {
				case 'ready':
					this.hydrate();
					break;
				case 'sendMessage':
					await this.handleUserMessage(message.content);
					break;
				case 'setModel':
					await this.handleModelChange(message.modelId);
					break;
				case 'newConversation':
					this.handleNewConversation();
					break;
				case 'clearHistory':
					this.handleClearHistory();
					break;
			}
		});
	}

	public async handleDiscussReview(context: string): Promise<void> {
		if (!context || !context.trim()) {
			vscode.window.showErrorMessage('No review context provided.');
			return;
		}

		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const activeModel = getOllamaModel(config);
		const conversation = this.conversationManager.createConversation(activeModel, 'Review Discussion');

		const injected: ChatMessage = {
			role: 'system',
			content: `Discuss this review context:\n\n${context}`,
			timestamp: Date.now(),
			model: activeModel,
		};
		this.conversationManager.addMessage(conversation.id, injected);
		this.lastInjectedContext = context;

		await vscode.commands.executeCommand('ai-review.focusChat');
		this.hydrate();
		this.sendMessageToWebview({ type: 'contextInjected', context });
	}

	private async handleUserMessage(content: string): Promise<void> {
		const trimmedContent = content.trim();
		if (!trimmedContent) {
			return;
		}

		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const activeModel = getOllamaModel(config);
		const conversation = this.conversationManager.getOrCreateActiveConversation(activeModel);

		const userMessage: ChatMessage = {
			role: 'user',
			content: trimmedContent,
			timestamp: Date.now(),
			model: activeModel,
		};
		this.conversationManager.addMessage(conversation.id, userMessage);
		this.sendMessageToWebview({ type: 'messageAdded', message: userMessage });

		if (trimmedContent === '/staged') {
			await this.handleStagedCommand(conversation.id, activeModel);
			return;
		}
		if (trimmedContent === '/help') {
			const helpMessage: ChatMessage = {
				role: 'system',
				content: [
					'Supported commands:',
					'- `/staged` Load currently staged git changes into chat context.',
					'- `/help` Show this command list.',
				].join('\n'),
				timestamp: Date.now(),
				model: activeModel,
			};
			this.conversationManager.addMessage(conversation.id, helpMessage);
			this.sendMessageToWebview({ type: 'messageAdded', message: helpMessage });
			return;
		}

		this.sendMessageToWebview({ type: 'streamStart' });

		let assistantResponse = '';
		try {
			const stagedDiff = await this.getStagedDiffContext();
			const prompt = this.buildPrompt(conversation, trimmedContent, stagedDiff);
			const provider = this.getAIProvider(config);
			assistantResponse = await provider.sendMessage(prompt, (chunk) => {
				assistantResponse += chunk;
				this.sendMessageToWebview({ type: 'streamChunk', chunk });
			});

			const assistantMessage: ChatMessage = {
				role: 'assistant',
				content: assistantResponse,
				timestamp: Date.now(),
				model: activeModel,
			};
			this.conversationManager.addMessage(conversation.id, assistantMessage);
			this.sendMessageToWebview({ type: 'streamEnd', content: assistantResponse });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to generate a response.';
			const limitMessage = toModelLimitChatMessage(message, activeModel);
			if (limitMessage) {
				const suffix = assistantResponse ? `\n\n${limitMessage}` : limitMessage;
				assistantResponse += suffix;
				this.sendMessageToWebview({ type: 'streamChunk', chunk: suffix });
				this.conversationManager.addMessage(conversation.id, {
					role: 'assistant',
					content: assistantResponse,
					timestamp: Date.now(),
					model: activeModel,
				});
			} else {
				this.sendMessageToWebview({ type: 'error', error: message });
			}
			this.sendMessageToWebview({ type: 'streamEnd', content: assistantResponse });
		}
	}

	private async handleStagedCommand(conversationId: string, modelId: string): Promise<void> {
		try {
			const stagedDiff = await this.getStagedDiffContext();
			const message = stagedDiff.hasDiff
				? `Loaded staged changes${stagedDiff.truncated ? ' (truncated)' : ''}:\n\n\`\`\`diff\n${stagedDiff.content}\n\`\`\``
				: 'No staged changes found. Stage files first with `git add` and try again.';
			const systemMessage: ChatMessage = {
				role: 'system',
				content: message,
				timestamp: Date.now(),
				model: modelId,
			};
			this.conversationManager.addMessage(conversationId, systemMessage);
			this.sendMessageToWebview({ type: 'messageAdded', message: systemMessage });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to read staged changes.';
			const systemMessage: ChatMessage = {
				role: 'system',
				content: `Failed to read staged changes: ${message}`,
				timestamp: Date.now(),
				model: modelId,
			};
			this.conversationManager.addMessage(conversationId, systemMessage);
			this.sendMessageToWebview({ type: 'messageAdded', message: systemMessage });
		}
	}

	private async handleModelChange(modelId: string): Promise<void> {
		const normalized = modelId.trim();
		if (!normalized) {
			return;
		}

		const config = vscode.workspace.getConfiguration('ollama-code-review');
		await config.update('model', normalized, vscode.ConfigurationTarget.Global);

		const active = this.conversationManager.getActiveConversation();
		if (active) {
			this.conversationManager.updateModel(active.id, normalized);
		}
		this.sendMessageToWebview({ type: 'modelUpdated', modelId: normalized });
		this.hydrate();
	}

	private handleNewConversation(): void {
		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const activeModel = getOllamaModel(config);
		const conversation = this.conversationManager.createConversation(activeModel);
		this.sendMessageToWebview({ type: 'conversationCreated', conversation });
		this.hydrate();
	}

	private handleClearHistory(): void {
		this.conversationManager.clearHistory();
		this.sendMessageToWebview({ type: 'historyCleared' });
		this.hydrate();
	}

	private hydrate(): void {
		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const activeModel = getOllamaModel(config);
		const conversation = this.conversationManager.getOrCreateActiveConversation(activeModel);
		this.sendMessageToWebview({
			type: 'hydrate',
			conversation,
			availableModels: this.getModelOptions(),
			activeModel,
		});
	}

	private buildPrompt(conversation: Conversation, latestUserMessage: string, stagedDiff: StagedDiffContext): string {
		const historyLines = conversation.messages
			.slice(-12)
			.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
			.join('\n\n');

		const reviewContext = this.lastInjectedContext
			? `\n\nReview Context:\n${this.lastInjectedContext}\n`
			: '';

		return [
			'You are an expert software engineer helping with code review follow-ups.',
			reviewContext,
			stagedDiff.hasDiff
				? `Staged Changes${stagedDiff.truncated ? ' (truncated to fit model context)' : ''}:\n${stagedDiff.content}`
				: 'Staged Changes:\n(none)',
			'Conversation history:',
			historyLines,
			`Latest user message:\n${latestUserMessage}`,
		].join('\n');
	}

	private async getStagedDiffContext(): Promise<StagedDiffContext> {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		if (!workspace) {
			return { content: '', hasDiff: false, truncated: false };
		}

		let stdout = '';
		try {
			({ stdout } = await execFileAsync(
				'git',
				['diff', '--cached', '--no-color'],
				{ cwd: workspace.uri.fsPath, maxBuffer: 4 * 1024 * 1024 },
			));
		} catch (error) {
			const execError = error as NodeJS.ErrnoException & { stderr?: string };
			if (execError.code === 'ENOENT') {
				throw new Error('Git is not installed or not available in PATH.');
			}
			const stderr = execError.stderr ?? '';
			if (/not a git repository/i.test(stderr)) {
				throw new Error('Current workspace is not a Git repository.');
			}
			throw new Error('Unable to read staged changes from Git.');
		}

		const full = stdout.trim();
		if (!full) {
			return { content: '', hasDiff: false, truncated: false };
		}

		if (full.length > STAGED_DIFF_MAX_CHARS) {
			return {
				content: `${full.slice(0, STAGED_DIFF_MAX_CHARS)}\n\n[... staged diff truncated ...]`,
				hasDiff: true,
				truncated: true,
			};
		}

		return { content: full, hasDiff: true, truncated: false };
	}

	private getAIProvider(config: vscode.WorkspaceConfiguration): AIProvider {
		const model = getOllamaModel(config);
		const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
		const temperature = config.get<number>('temperature', 0);
		const streamingEnabled = config.get<boolean>('streaming.enabled', true);

		return {
			sendMessage: async (prompt: string, onChunk: (chunk: string) => void): Promise<string> => {
				if (streamingEnabled) {
					if (isClaudeModel(model)) {
						return streamClaudeAPI(prompt, config, onChunk);
					}
					if (isOpenAICompatibleModel(model)) {
						return streamOpenAICompatibleAPI(prompt, config, onChunk);
					}
					const isCloudNonOllama = isGlmModel(model)
						|| isHuggingFaceModel(model)
						|| isGeminiModel(model)
						|| isMistralModel(model)
						|| isMiniMaxModel(model);
					if (!isCloudNonOllama) {
						return streamOllamaAPI(prompt, model, endpoint, temperature, onChunk);
					}
				}

				const full = await callAIProvider(prompt, config, model, endpoint, temperature);
				onChunk(full);
				return full;
			},
		};
	}

	private getModelOptions(): string[] {
		const config = vscode.workspace.getConfiguration('ollama-code-review');
		return config.get<string[]>('availableModels', [
			'kimi-k2.5:cloud',
			'qwen3-coder:480b-cloud',
			'glm-4.7:cloud',
			'glm-4.7-flash',
			'huggingface',
			'gemini-2.5-flash',
			'gemini-2.5-pro',
			'mistral-large-latest',
			'mistral-small-latest',
			'codestral-latest',
			'MiniMax-M2.5',
			'openai-compatible',
			'qwen2.5-coder:14b-instruct-q4_0',
			'claude-sonnet-4-20250514',
			'claude-opus-4-20250514',
			'claude-3-7-sonnet-20250219',
		]);
	}

	private sendMessageToWebview(message: WebviewOutboundMessage): void {
		void this.view?.webview.postMessage(message);
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = this.getNonce();
		const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'images', 'icon.png'));

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: vscode-resource:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;" />
	<title>AI Review Chat</title>
	<style>
		:root {
			color-scheme: light dark;
		}
		body {
			margin: 0;
			padding: 8px;
			font-family: var(--vscode-font-family);
			height: 100vh;
			display: flex;
			flex-direction: column;
			gap: 8px;
			box-sizing: border-box;
		}
		.header {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		.header img {
			width: 16px;
			height: 16px;
		}
		select, button, textarea {
			font-family: inherit;
			font-size: 12px;
		}
		#model {
			flex: 1;
			padding: 6px;
		}
		.controls {
			display: flex;
			gap: 6px;
		}
		#history {
			flex: 1;
			overflow-y: auto;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 8px;
			background: var(--vscode-editor-background);
		}
		.message {
			margin-bottom: 10px;
			padding: 8px;
			border-radius: 6px;
			line-height: 1.45;
		}
		.message.user {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.message.assistant {
			background: var(--vscode-editor-inactiveSelectionBackground);
		}
		.message.system {
			background: var(--vscode-textBlockQuote-background);
			border-left: 3px solid var(--vscode-textBlockQuote-border);
		}
		.message .meta {
			font-size: 11px;
			opacity: 0.8;
			margin-bottom: 4px;
		}
		.input {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 6px;
			align-items: stretch;
		}
		#input {
			resize: none;
			height: 56px;
			padding: 8px;
			width: 100%;
			min-width: 0;
			box-sizing: border-box;
		}
		.command-suggestions {
			position: relative;
			width: 100%;
			min-width: 0;
		}
		#commandList {
			position: absolute;
			left: 0;
			right: 0;
			bottom: 100%;
			margin-bottom: 4px;
			max-height: 120px;
			overflow-y: auto;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			background: var(--vscode-editorWidget-background);
			display: none;
			z-index: 5;
		}
		.command-item {
			padding: 6px 8px;
			font-size: 12px;
			cursor: pointer;
		}
		.command-item:hover,
		.command-item.active {
			background: var(--vscode-list-hoverBackground);
		}
		button {
			padding: 6px 10px;
			border: 1px solid var(--vscode-button-border);
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			cursor: pointer;
		}
		#send {
			min-width: 92px;
		}
		button.secondary {
			background: var(--vscode-inputOption-activeBackground);
			color: var(--vscode-foreground);
		}
		.status {
			min-height: 16px;
			font-size: 11px;
			opacity: 0.8;
		}
	</style>
</head>
<body>
	<div class="header">
		<img src="${iconUri}" alt="AI" />
		<select id="model"></select>
	</div>
	<div class="controls">
		<button id="newChat" class="secondary" type="button">New Chat</button>
		<button id="clear" class="secondary" type="button">Clear</button>
	</div>
	<div id="history"></div>
	<div class="input">
		<div class="command-suggestions">
			<div id="commandList"></div>
			<textarea id="input" placeholder="Ask a question... Use / for commands"></textarea>
		</div>
		<button id="send" type="button">Send</button>
	</div>
	<div id="status" class="status"></div>

	<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
	<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js"></script>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const historyEl = document.getElementById('history');
		const inputEl = document.getElementById('input');
		const sendBtn = document.getElementById('send');
		const modelEl = document.getElementById('model');
		const statusEl = document.getElementById('status');
		const newChatBtn = document.getElementById('newChat');
		const clearBtn = document.getElementById('clear');
		const commandListEl = document.getElementById('commandList');
		const supportedCommands = ${JSON.stringify(SUPPORTED_CHAT_COMMANDS)};

		let messages = [];
		let isStreaming = false;
		let streamingIndex = -1;
		let streamRenderTimer = null;
		let filteredCommands = [];
		let activeCommandIndex = 0;

		function escapeHtml(value) {
			return value
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
		}

		function roleLabel(role) {
			if (role === 'assistant') return 'AI';
			if (role === 'system') return 'Context';
			return 'You';
		}

		function setStreaming(value) {
			isStreaming = value;
			sendBtn.disabled = value;
			inputEl.disabled = value;
			statusEl.textContent = value ? 'Streaming response...' : '';
		}

		function scheduleStreamRender() {
			if (streamRenderTimer) return;
			streamRenderTimer = setTimeout(() => {
				renderHistory();
				streamRenderTimer = null;
			}, 60);
		}

		function renderHistory() {
			historyEl.innerHTML = messages.map((message) => {
				let html;
				try {
					const rawContent = message.content || '';
					if (typeof marked !== 'undefined') {
						const parsed = marked.parse(rawContent);
						html = typeof DOMPurify !== 'undefined'
							? DOMPurify.sanitize(parsed)
							: String(parsed).replace(/href\\s*=\\s*\"javascript:[^\"]*\"/gi, 'href="#"');
					} else {
						html = '<p>' + escapeHtml(rawContent) + '</p>';
					}
				} catch {
					html = '<p>' + escapeHtml(message.content || '') + '</p>';
				}
				return '<div class="message ' + message.role + '">' +
					'<div class="meta">' + roleLabel(message.role) + '</div>' +
					'<div>' + html + '</div>' +
				'</div>';
			}).join('');
			historyEl.scrollTop = historyEl.scrollHeight;
		}

		function sendCurrentMessage() {
			const content = inputEl.value.trim();
			if (!content || isStreaming) {
				return;
			}
			hideCommandSuggestions();
			vscode.postMessage({ type: 'sendMessage', content });
			inputEl.value = '';
		}

		function hideCommandSuggestions() {
			filteredCommands = [];
			activeCommandIndex = 0;
			commandListEl.style.display = 'none';
			commandListEl.innerHTML = '';
		}

		function applyCommandSelection() {
			if (!filteredCommands.length) return;
			const selected = filteredCommands[activeCommandIndex] || filteredCommands[0];
			inputEl.value = selected + ' ';
			hideCommandSuggestions();
		}

		function renderCommandSuggestions() {
			const query = inputEl.value.trim();
			if (!query.startsWith('/')) {
				hideCommandSuggestions();
				return;
			}

			filteredCommands = supportedCommands.filter((command) => command.startsWith(query));
			if (!filteredCommands.length) {
				hideCommandSuggestions();
				return;
			}

			if (activeCommandIndex >= filteredCommands.length) {
				activeCommandIndex = 0;
			}

			commandListEl.innerHTML = filteredCommands.map((command, index) => {
				const activeClass = index === activeCommandIndex ? ' active' : '';
				return '<div class="command-item' + activeClass + '" data-command="' + command + '">' + command + '</div>';
			}).join('');
			commandListEl.style.display = 'block';
		}

		sendBtn.addEventListener('click', sendCurrentMessage);
		inputEl.addEventListener('keydown', (event) => {
			if (commandListEl.style.display === 'block' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
				event.preventDefault();
				if (event.key === 'ArrowDown') {
					activeCommandIndex = (activeCommandIndex + 1) % filteredCommands.length;
				} else {
					activeCommandIndex = (activeCommandIndex - 1 + filteredCommands.length) % filteredCommands.length;
				}
				renderCommandSuggestions();
				return;
			}
			if (commandListEl.style.display === 'block' && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
				event.preventDefault();
				applyCommandSelection();
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				sendCurrentMessage();
			}
		});
		inputEl.addEventListener('input', renderCommandSuggestions);
		inputEl.addEventListener('blur', () => {
			setTimeout(() => hideCommandSuggestions(), 100);
		});
		commandListEl.addEventListener('mousedown', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const selected = target.getAttribute('data-command');
			if (!selected) return;
			inputEl.value = selected + ' ';
			hideCommandSuggestions();
			inputEl.focus();
		});

		modelEl.addEventListener('change', () => {
			vscode.postMessage({ type: 'setModel', modelId: modelEl.value });
		});

		newChatBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'newConversation' });
		});

		clearBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'clearHistory' });
		});

		window.addEventListener('message', (event) => {
			const message = event.data;

			switch (message.type) {
				case 'hydrate':
					messages = message.conversation.messages || [];
					modelEl.innerHTML = (message.availableModels || []).map((model) => {
						const selected = model === message.activeModel ? ' selected' : '';
						return '<option value="' + escapeHtml(model) + '"' + selected + '>' + escapeHtml(model) + '</option>';
					}).join('');
					renderHistory();
					break;
				case 'messageAdded':
					messages.push(message.message);
					renderHistory();
					break;
				case 'streamStart':
					setStreaming(true);
					messages.push({ role: 'assistant', content: '', timestamp: Date.now() });
					streamingIndex = messages.length - 1;
					renderHistory();
					break;
				case 'streamChunk':
					if (streamingIndex >= 0 && messages[streamingIndex]) {
						messages[streamingIndex].content += message.chunk;
						scheduleStreamRender();
					}
					break;
				case 'streamEnd':
					setStreaming(false);
					streamingIndex = -1;
					if (!messages.length && message.content) {
						messages.push({ role: 'assistant', content: message.content, timestamp: Date.now() });
					}
					renderHistory();
					inputEl.focus();
					break;
				case 'historyCleared':
					messages = [];
					renderHistory();
					break;
				case 'modelUpdated':
					statusEl.textContent = 'Model set to ' + message.modelId;
					setTimeout(() => {
						if (!isStreaming) {
							statusEl.textContent = '';
						}
					}, 1500);
					break;
				case 'conversationCreated':
					messages = message.conversation.messages || [];
					renderHistory();
					break;
				case 'contextInjected':
					statusEl.textContent = 'Review context added to this conversation.';
					setTimeout(() => {
						if (!isStreaming) {
							statusEl.textContent = '';
						}
					}, 2500);
					break;
				case 'error':
					setStreaming(false);
					statusEl.textContent = message.error || 'An error occurred.';
					break;
			}
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}

	private getNonce(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		for (let i = 0; i < 32; i += 1) {
			result += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return result;
	}
}
