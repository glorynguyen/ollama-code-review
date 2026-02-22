import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { type ProviderRequestContext, providerRegistry } from '../providers';
import { getOllamaModel } from '../utils';
import {
	CONTEXT_MENTION_DEFS,
	pickWorkspaceFile,
	resolveAtMentions,
	type ResolvedContext,
} from './contextProviders';
import { ConversationManager } from './conversationManager';
import { toModelLimitChatMessage } from './modelErrorUtils';
import type { ChatMessage, Conversation, WebviewInboundMessage, WebviewOutboundMessage } from './types';

interface AIProvider {
	sendMessage(prompt: string, onChunk: (chunk: string) => void): Promise<string>;
}

const execFileAsync = promisify(execFile);
const STAGED_DIFF_MAX_CHARS = 20000;
const SUPPORTED_CHAT_COMMANDS = ['/help'] as const;

/** Serialisable form of ContextMentionDef passed to the webview. */
interface WebviewMentionDef {
	trigger: string;
	description: string;
}

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
	/** Stores the last completed review text so @review can reference it. */
	private lastReviewText = '';

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly conversationManager: ConversationManager,
	) {
		ChatSidebarProvider.instance = this;
	}

	public static getInstance(): ChatSidebarProvider | undefined {
		return ChatSidebarProvider.instance;
	}

	/**
	 * Stores the latest completed review text so `@review` can reference it.
	 * Called by the review panel after each review completes.
	 */
	public setLastReview(text: string): void {
		this.lastReviewText = text;
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
				case 'pickFile':
					await this.handlePickFile(message.insertOffset);
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
		// Also make the review available via @review
		this.lastReviewText = context;

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

		if (trimmedContent === '/help') {
			const helpMessage: ChatMessage = {
				role: 'system',
				content: [
					'**Commands:**',
					'- `/help` — Show this help message.',
					'',
					'**@-Context mentions** (type `@` to see suggestions):',
					'- `@file <path>` — Include a workspace file as context.',
					'- `@diff` — Include current staged git changes.',
					'- `@selection` — Include the current editor selection.',
					'- `@review` — Include the most recent AI review.',
					'- `@knowledge` — Include team knowledge base entries.',
					'',
					'*Example:* `@file src/auth.ts explain the token validation logic`',
				].join('\n'),
				timestamp: Date.now(),
				model: activeModel,
			};
			this.conversationManager.addMessage(conversation.id, helpMessage);
			this.sendMessageToWebview({ type: 'messageAdded', message: helpMessage });
			return;
		}

		// Resolve any @-mention context references before sending to AI
		const { cleanedMessage, contexts, unresolved } = await resolveAtMentions(
			trimmedContent,
			this.lastReviewText,
		);

		if (unresolved.length > 0) {
			this.sendMessageToWebview({ type: 'mentionWarning', mentions: unresolved });
		}

		// Use the cleaned message (without @-tokens) as the actual user question
		const effectiveMessage = cleanedMessage || trimmedContent;

		this.sendMessageToWebview({ type: 'streamStart' });

		let assistantResponse = '';
		try {
			const stagedDiff = await this.getStagedDiffContext();
			const prompt = this.buildPrompt(conversation, effectiveMessage, stagedDiff, contexts);
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

	private buildPrompt(
		conversation: Conversation,
		latestUserMessage: string,
		stagedDiff: StagedDiffContext,
		contexts: ResolvedContext[] = [],
	): string {
		const historyLines = conversation.messages
			.slice(-12)
			.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
			.join('\n\n');

		const reviewContext = this.lastInjectedContext
			? `\n\nReview Context:\n${this.lastInjectedContext}\n`
			: '';

		const contextSection = contexts.length > 0
			? '\n\nContext References:\n' + contexts.map(c => `### ${c.label}\n${c.content}`).join('\n\n')
			: '';

		const stagedSection = stagedDiff.hasDiff
			? `Staged Changes${stagedDiff.truncated ? ' (truncated to fit model context)' : ''}:\n${stagedDiff.content}`
			: '';

		return [
			'You are an expert software engineer helping with code review follow-ups.',
			reviewContext,
			contextSection,
			stagedSection,
			'Conversation history:',
			historyLines,
			`Latest user message:\n${latestUserMessage}`,
		].filter(Boolean).join('\n');
	}

	private async handlePickFile(insertOffset: number): Promise<void> {
		const relativePath = await pickWorkspaceFile();
		if (relativePath) {
			this.sendMessageToWebview({ type: 'filePicked', relativePath, insertOffset });
		}
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
		const provider = providerRegistry.resolve(model);
		const requestContext: ProviderRequestContext = {
			config,
			model,
			endpoint,
			temperature,
		};

		return {
			sendMessage: async (prompt: string, onChunk: (chunk: string) => void): Promise<string> => {
				if (streamingEnabled && provider.supportsStreaming()) {
					return provider.stream(prompt, requestContext, { onChunk });
				}

				const full = await provider.generate(prompt, requestContext);
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
		const mentionDefs: WebviewMentionDef[] = CONTEXT_MENTION_DEFS.map(d => ({
			trigger: d.trigger,
			description: d.description,
		}));

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
			--apple-font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', sans-serif;
			--apple-bg: color-mix(in srgb, var(--vscode-editor-background) 96%, #0b0b0c);
			--apple-surface: color-mix(in srgb, var(--vscode-editor-background) 88%, #1b1b1f);
			--apple-surface-strong: color-mix(in srgb, var(--vscode-editor-background) 78%, #242428);
			--apple-border: color-mix(in srgb, var(--vscode-panel-border) 62%, #3a3a40);
			--apple-text: color-mix(in srgb, var(--vscode-foreground) 96%, #f5f5f7);
			--apple-muted: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, #c7c7cc);
			--apple-accent: #0a84ff;
			--apple-accent-strong: #0071e3;
			--apple-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
		}
		body {
			margin: 0;
			padding: 10px;
			font-family: var(--apple-font);
			color: var(--apple-text);
			height: 100vh;
			display: flex;
			flex-direction: column;
			gap: 10px;
			box-sizing: border-box;
			background:
				radial-gradient(120% 70% at -10% -20%, rgba(10, 132, 255, 0.14) 0%, rgba(10, 132, 255, 0) 55%),
				radial-gradient(100% 60% at 120% 120%, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0) 60%),
				var(--apple-bg);
		}
		.header {
			display: flex;
			gap: 10px;
			align-items: center;
			padding: 8px;
			border-radius: 14px;
			background: linear-gradient(180deg, color-mix(in srgb, var(--apple-surface-strong) 92%, #111114), var(--apple-surface));
			border: 1px solid var(--apple-border);
			box-shadow: var(--apple-shadow);
			backdrop-filter: blur(16px) saturate(140%);
		}
		.header img {
			width: 18px;
			height: 18px;
			padding: 7px;
			border-radius: 11px;
			background: color-mix(in srgb, var(--apple-surface) 65%, #ffffff);
			border: 1px solid var(--apple-border);
		}
		select, button, textarea {
			font-family: inherit;
			font-size: 12px;
		}
		#model {
			flex: 1;
			padding: 9px 12px;
			border-radius: 11px;
			border: 1px solid var(--apple-border);
			background: color-mix(in srgb, var(--apple-surface) 82%, #ffffff);
			color: var(--apple-text);
			transition: border-color 120ms ease, box-shadow 120ms ease;
		}
		.controls {
			display: flex;
			gap: 8px;
		}
		#history {
			flex: 1;
			overflow-y: auto;
			border: 1px solid var(--apple-border);
			border-radius: 16px;
			padding: 12px;
			background: linear-gradient(180deg, color-mix(in srgb, var(--apple-surface) 92%, #121216), color-mix(in srgb, var(--apple-surface) 80%, #16161b));
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), var(--apple-shadow);
			backdrop-filter: blur(14px) saturate(130%);
		}
		.message {
			margin-bottom: 11px;
			padding: 11px 12px;
			border-radius: 13px;
			line-height: 1.5;
			border: 1px solid transparent;
			animation: riseIn 180ms ease;
		}
		@keyframes riseIn {
			from {
				opacity: 0;
				transform: translateY(6px);
			}
			to {
				opacity: 1;
				transform: translateY(0);
			}
		}
		.message.user {
			background: linear-gradient(180deg, color-mix(in srgb, var(--apple-accent) 90%, #44a1ff), var(--apple-accent-strong));
			color: #ffffff;
			border-color: color-mix(in srgb, var(--apple-accent-strong) 80%, #ffffff);
			box-shadow: 0 8px 18px rgba(10, 132, 255, 0.34);
		}
		.message.assistant {
			background: color-mix(in srgb, var(--apple-surface) 88%, #101015);
			border-color: var(--apple-border);
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
		}
		.message.system {
			background: color-mix(in srgb, var(--apple-surface) 78%, #2b2414);
			border-color: color-mix(in srgb, var(--apple-border) 60%, #ffbf47);
			box-shadow: inset 0 0 0 1px rgba(255, 191, 71, 0.16);
		}
		.message .meta {
			font-size: 11px;
			opacity: 0.95;
			margin-bottom: 6px;
			font-weight: 600;
			letter-spacing: 0.01em;
			color: var(--apple-muted);
		}
		.input {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 10px;
			align-items: stretch;
			padding: 8px;
			border-radius: 14px;
			border: 1px solid var(--apple-border);
			background: linear-gradient(180deg, color-mix(in srgb, var(--apple-surface-strong) 92%, #121216), var(--apple-surface));
			box-shadow: var(--apple-shadow);
			backdrop-filter: blur(16px) saturate(140%);
		}
		#input {
			resize: none;
			height: 56px;
			padding: 10px 12px;
			width: 100%;
			min-width: 0;
			box-sizing: border-box;
			border-radius: 11px;
			border: 1px solid var(--apple-border);
			background: color-mix(in srgb, var(--apple-surface) 90%, #0f0f13);
			color: var(--apple-text);
			transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
		}
		.command-suggestions {
			position: relative;
			width: 100%;
			min-width: 0;
		}
		#commandList, #mentionList {
			position: absolute;
			left: 0;
			right: 0;
			bottom: 100%;
			margin-bottom: 8px;
			max-height: 150px;
			overflow-y: auto;
			border: 1px solid var(--apple-border);
			border-radius: 11px;
			background: color-mix(in srgb, var(--apple-surface-strong) 90%, #121216);
			display: none;
			z-index: 5;
			box-shadow: var(--apple-shadow);
		}
		.command-item {
			padding: 8px 10px;
			font-size: 12px;
			cursor: pointer;
			display: flex;
			gap: 6px;
			align-items: baseline;
		}
		.command-item:hover,
		.command-item.active {
			background: color-mix(in srgb, var(--apple-accent) 20%, transparent);
		}
		.mention-trigger {
			font-weight: 600;
			color: var(--vscode-symbolIcon-colorForeground, var(--vscode-charts-blue));
			white-space: nowrap;
		}
		.mention-desc {
			opacity: 0.75;
			font-size: 11px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		button {
			padding: 9px 14px;
			border: 1px solid color-mix(in srgb, var(--apple-accent-strong) 84%, #ffffff);
			background: linear-gradient(180deg, color-mix(in srgb, var(--apple-accent) 88%, #45a5ff), var(--apple-accent-strong));
			color: #ffffff;
			border-radius: 11px;
			cursor: pointer;
			font-weight: 600;
			letter-spacing: 0.01em;
			transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
			box-shadow: 0 9px 18px rgba(10, 132, 255, 0.33);
		}
		#send {
			min-width: 96px;
		}
		button.secondary {
			background: color-mix(in srgb, var(--apple-surface) 86%, #111115);
			color: var(--apple-text);
			border-color: var(--apple-border);
			box-shadow: 0 7px 14px rgba(0, 0, 0, 0.18);
		}
		button:hover {
			transform: translateY(-1px);
			filter: brightness(1.04);
		}
		button:active {
			transform: translateY(0);
			filter: brightness(0.98);
		}
		button:disabled {
			opacity: 0.6;
			cursor: default;
			transform: none;
			box-shadow: none;
		}
		select:focus,
		textarea:focus,
		button:focus-visible {
			outline: none;
			border-color: color-mix(in srgb, var(--apple-accent) 82%, #ffffff);
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--apple-accent) 30%, transparent);
		}
		.status {
			min-height: 16px;
			font-size: 11px;
			opacity: 0.9;
			color: var(--apple-muted);
			padding: 0 4px;
		}
		@media (max-width: 520px) {
			body {
				padding: 8px;
				gap: 8px;
			}
			.header,
			.input {
				padding: 7px;
				border-radius: 12px;
			}
			.controls {
				gap: 6px;
			}
			button {
				padding: 8px 11px;
			}
			#input {
				height: 52px;
			}
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
			<div id="mentionList"></div>
			<textarea id="input" placeholder="Ask a question... Type @ for context or /help for commands"></textarea>
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
		const mentionListEl = document.getElementById('mentionList');
		const supportedCommands = ${JSON.stringify(SUPPORTED_CHAT_COMMANDS)};
		const mentionDefs = ${JSON.stringify(mentionDefs)};

		let messages = [];
		let isStreaming = false;
		let streamingIndex = -1;
		let streamRenderTimer = null;

		// / command state
		let filteredCommands = [];
		let activeCommandIndex = 0;

		// @ mention state
		let filteredMentions = [];
		let activeMentionIndex = 0;

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
			hideMentionSuggestions();
			vscode.postMessage({ type: 'sendMessage', content });
			inputEl.value = '';
		}

		// ── / command suggestions ──────────────────────────────────────────────

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

		// ── @ mention suggestions ──────────────────────────────────────────────

		/**
		 * Returns the @-mention "token" currently being typed at the cursor,
		 * or null if no @-mention is active.
		 * Example: "check @fi" at cursor pos 9 → { query: 'fi', start: 6 }
		 */
		function getAtMentionAtCursor() {
			const pos = inputEl.selectionStart;
			const textBeforeCursor = inputEl.value.slice(0, pos);
			const match = textBeforeCursor.match(/@(\\w*)$/);
			if (!match) return null;
			return { query: match[1].toLowerCase(), start: pos - match[0].length };
		}

		function hideMentionSuggestions() {
			filteredMentions = [];
			activeMentionIndex = 0;
			mentionListEl.style.display = 'none';
			mentionListEl.innerHTML = '';
		}

		function renderMentionSuggestions() {
			const atMention = getAtMentionAtCursor();
			if (!atMention) {
				hideMentionSuggestions();
				return;
			}
			// Hide / suggestions when @ is active
			hideCommandSuggestions();

			filteredMentions = mentionDefs.filter((m) =>
				m.trigger.slice(1).startsWith(atMention.query)
			);
			if (!filteredMentions.length) {
				hideMentionSuggestions();
				return;
			}
			if (activeMentionIndex >= filteredMentions.length) {
				activeMentionIndex = 0;
			}

			mentionListEl.innerHTML = filteredMentions.map((m, index) => {
				const activeClass = index === activeMentionIndex ? ' active' : '';
				return '<div class="command-item' + activeClass + '" data-trigger="' + m.trigger + '">' +
					'<span class="mention-trigger">' + escapeHtml(m.trigger) + '</span>' +
					'<span class="mention-desc">' + escapeHtml(m.description) + '</span>' +
				'</div>';
			}).join('');
			mentionListEl.style.display = 'block';
		}

		function applyMentionSelection() {
			if (!filteredMentions.length) return;
			const selected = filteredMentions[activeMentionIndex] || filteredMentions[0];
			const atMention = getAtMentionAtCursor();
			if (!atMention) return;

			const val = inputEl.value;
			const before = val.slice(0, atMention.start);
			const after = val.slice(inputEl.selectionStart);
			hideMentionSuggestions();

			if (selected.trigger === '@file') {
				// Insert @file placeholder and ask extension to open file picker
				const inserted = '@file ';
				inputEl.value = before + inserted + after;
				const newPos = atMention.start + inserted.length;
				inputEl.setSelectionRange(newPos, newPos);
				vscode.postMessage({ type: 'pickFile', insertOffset: atMention.start });
			} else {
				// Insert the trigger + space so user can keep typing their message
				const inserted = selected.trigger + ' ';
				inputEl.value = before + inserted + after;
				const newPos = atMention.start + inserted.length;
				inputEl.setSelectionRange(newPos, newPos);
				inputEl.focus();
			}
		}

		// ── event listeners ────────────────────────────────────────────────────

		sendBtn.addEventListener('click', sendCurrentMessage);

		inputEl.addEventListener('keydown', (event) => {
			const mentionOpen = mentionListEl.style.display === 'block';
			const commandOpen = commandListEl.style.display === 'block';

			if (mentionOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
				event.preventDefault();
				if (event.key === 'ArrowDown') {
					activeMentionIndex = (activeMentionIndex + 1) % filteredMentions.length;
				} else {
					activeMentionIndex = (activeMentionIndex - 1 + filteredMentions.length) % filteredMentions.length;
				}
				renderMentionSuggestions();
				return;
			}
			if (mentionOpen && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
				event.preventDefault();
				applyMentionSelection();
				return;
			}
			if (mentionOpen && event.key === 'Escape') {
				event.preventDefault();
				hideMentionSuggestions();
				return;
			}

			if (commandOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
				event.preventDefault();
				if (event.key === 'ArrowDown') {
					activeCommandIndex = (activeCommandIndex + 1) % filteredCommands.length;
				} else {
					activeCommandIndex = (activeCommandIndex - 1 + filteredCommands.length) % filteredCommands.length;
				}
				renderCommandSuggestions();
				return;
			}
			if (commandOpen && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
				event.preventDefault();
				applyCommandSelection();
				return;
			}

			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				sendCurrentMessage();
			}
		});

		inputEl.addEventListener('input', () => {
			// Only one dropdown at a time: @ takes priority over /
			const atMention = getAtMentionAtCursor();
			if (atMention !== null) {
				hideCommandSuggestions();
				renderMentionSuggestions();
			} else {
				hideMentionSuggestions();
				renderCommandSuggestions();
			}
		});

		inputEl.addEventListener('blur', () => {
			setTimeout(() => {
				hideCommandSuggestions();
				hideMentionSuggestions();
			}, 100);
		});

		commandListEl.addEventListener('mousedown', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const selected = target.closest('[data-command]')?.getAttribute('data-command');
			if (!selected) return;
			inputEl.value = selected + ' ';
			hideCommandSuggestions();
			inputEl.focus();
		});

		mentionListEl.addEventListener('mousedown', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const trigger = target.closest('[data-trigger]')?.getAttribute('data-trigger');
			if (!trigger) return;
			// Simulate selecting the mention by setting the filteredMentions and applying
			const idx = filteredMentions.findIndex(m => m.trigger === trigger);
			if (idx >= 0) { activeMentionIndex = idx; }
			applyMentionSelection();
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

		// ── extension → webview messages ───────────────────────────────────────

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
						if (!isStreaming) { statusEl.textContent = ''; }
					}, 1500);
					break;
				case 'conversationCreated':
					messages = message.conversation.messages || [];
					renderHistory();
					break;
				case 'contextInjected':
					statusEl.textContent = 'Review context added to this conversation.';
					setTimeout(() => {
						if (!isStreaming) { statusEl.textContent = ''; }
					}, 2500);
					break;
				case 'filePicked': {
					// Insert the selected file path at the offset where @file was placed
					const insertOffset = message.insertOffset ?? 0;
					const prefix = '@file ';
					const val = inputEl.value;
					// Find the end of the '@file ' prefix starting at insertOffset
					const prefixEnd = insertOffset + prefix.length;
					const before = val.slice(0, prefixEnd);
					const after = val.slice(prefixEnd);
					const relativePath = message.relativePath || '';
					inputEl.value = before + relativePath + ' ' + after;
					const newCursorPos = prefixEnd + relativePath.length + 1;
					inputEl.setSelectionRange(newCursorPos, newCursorPos);
					inputEl.focus();
					break;
				}
				case 'mentionWarning':
					if (message.mentions && message.mentions.length > 0) {
						statusEl.textContent = 'Could not resolve: ' + message.mentions.join(', ');
						setTimeout(() => {
							if (!isStreaming) { statusEl.textContent = ''; }
						}, 3000);
					}
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
