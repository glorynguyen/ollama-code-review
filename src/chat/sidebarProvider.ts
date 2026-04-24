import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveAndValidatePath } from '../utils/pathValidation';
import { type ProviderRequestContext, providerRegistry, DEFAULT_MODELS } from '../providers';
import { getOllamaModel } from '../utils';
import {
	CONTEXT_MENTION_DEFS,
	pickWorkspaceFile,
	resolveAtMentions,
	type ResolvedContext,
} from './contextProviders';
import { ConversationManager } from './conversationManager';
import { AgenticChatOrchestrator } from './agenticOrchestrator';
import { toModelLimitChatMessage } from './modelErrorUtils';
import type { ChatMessage, Conversation, WebviewInboundMessage, WebviewOutboundMessage } from './types';
import type { McpClientManager } from '../mcp/mcpClientManager';

interface AIProvider {
	sendMessage(messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<string>;
}

const SUPPORTED_CHAT_COMMANDS = ['/help'] as const;

/** Serialisable form of ContextMentionDef passed to the webview. */
interface WebviewMentionDef {
	trigger: string;
	description: string;
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
		private readonly globalStoragePath: string,
		private readonly mcpManager: McpClientManager,
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

		webviewView.onDidDispose(() => {
			this.view = undefined;
		});

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
				case 'applyCode':
					await this.handleApplyCode(message.code);
					break;
				case 'insertCode':
					await this.handleInsertCode(message.code);
					break;
				case 'copyCode':
					await this.handleCopyCode(message.code);
					break;
				case 'createFile':
					await this.handleCreateFile(message.code);
					break;
			}
		});
	}

	private async handleApplyCode(code: string): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('No active editor found to apply code.');
			return;
		}

		const processedCode = this.stripMarkdownFences(code);
		const selection = editor.selection;

		if (selection.isEmpty) {
			// Pass the already processed code directly to the insertion logic
			await this._insertCode(editor, editor.selection.active, processedCode);
			return;
		}

		// Adjust indentation to match the start of the selection
		const indentedCode = this.adjustIndentation(processedCode, editor, selection.start);

		try {
			await editor.edit(editBuilder => {
				editBuilder.replace(selection, indentedCode);
			});
			vscode.window.showInformationMessage('Code applied to selection.');
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to apply code: ${err}`);
		}
	}

	private async handleInsertCode(code: string): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('No active editor found to insert code.');
			return;
		}

		const processedCode = this.stripMarkdownFences(code);
		await this._insertCode(editor, editor.selection.active, processedCode);
	}

	/** Core insertion logic to avoid redundant processing */
	private async _insertCode(editor: vscode.TextEditor, position: vscode.Position, processedCode: string): Promise<void> {
		const indentedCode = this.adjustIndentation(processedCode, editor, position);

		try {
			await editor.edit(editBuilder => {
				editBuilder.insert(position, indentedCode);
			});
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to insert code: ${err}`);
		}
	}

	/** Strips accidental markdown code fences if the model included them. */
	private stripMarkdownFences(code: string): string {
		// Looks for the first markdown code block, ignoring surrounding text
		const fenceMatch = code.match(/```[\w]*\n([\s\S]*?)```/);
		if (fenceMatch) {
			return fenceMatch[1].trim();
		}
		// Fallback if no markdown fences are found
		return code.trim();
	}

	/** Adjusts the indentation of a code block to match the target line in the editor. */
	private adjustIndentation(code: string, editor: vscode.TextEditor, position: vscode.Position): string {
		const line = editor.document.lineAt(position.line);
		const indentation = line.text.substring(0, line.firstNonWhitespaceCharacterIndex);
		
		const lines = code.split('\n');
		if (lines.length <= 1) {
			return code;
		}

		// Find minimum indentation in the provided code to preserve relative indentation
		let minCodeIndent = Infinity;
		for (let i = 0; i < lines.length; i++) {
			const l = lines[i];
			if (l.trim().length === 0) { continue; }
			const match = l.match(/^\s*/);
			const indentLen = match ? match[0].length : 0;
			if (indentLen < minCodeIndent) {
				minCodeIndent = indentLen;
			}
		}

		if (minCodeIndent === Infinity) { minCodeIndent = 0; }

		return lines.map((l, i) => {
			if (l.trim().length === 0) { return ''; }
			
			// Safety: Ensure we don't slice more than the line's length
			const safeIndent = Math.min(l.length, minCodeIndent);
			const relativeIndent = l.substring(safeIndent);
			
			// DO NOT add base indentation to the very first line.
			// The editor is already positioned correctly (either at start of line + indent, or mid-line).
			if (i === 0) {
				return relativeIndent;
			}
			
			// Add the target line's base indentation to subsequent lines
			return indentation + relativeIndent;
		}).join('\n');
	}

	private async handleCopyCode(code: string): Promise<void> {
		await vscode.env.clipboard.writeText(code);
	}

	private async handleCreateFile(code: string): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder open.');
			return;
		}

		const repoPaths = workspaceFolders.map(f => f.uri.fsPath);
		const fileName = await vscode.window.showInputBox({
			prompt: 'Enter the relative path for the new file',
			placeHolder: 'e.g., src/components/NewComponent.tsx',
			ignoreFocusOut: true,
		});

		if (!fileName) {
			return;
		}

		const validation = await resolveAndValidatePath(fileName, repoPaths);
		if (!validation.valid) {
			vscode.window.showErrorMessage(validation.error);
			return;
		}
		const { resolvedPath } = validation;

		try {
			const processedCode = this.stripMarkdownFences(code);
			await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

			// Confirm before overwriting an existing file
			try {
				await fs.access(resolvedPath);
				const answer = await vscode.window.showWarningMessage(
					`File '${fileName}' already exists. Overwrite?`,
					{ modal: true },
					'Overwrite',
					'Cancel',
				);
				if (answer !== 'Overwrite') {
					return;
				}
			} catch { /* file doesn't exist — proceed */ }

			await fs.writeFile(resolvedPath, processedCode, 'utf-8');

			const doc = await vscode.workspace.openTextDocument(resolvedPath);
			await vscode.window.showTextDocument(doc);
			vscode.window.showInformationMessage(`File created: ${fileName}`);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to create file: ${err?.message || String(err)}`);
		}
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

	public async handleDiscussFinding(context: string, title = 'Finding Follow-up'): Promise<void> {
		if (!context || !context.trim()) {
			vscode.window.showErrorMessage('No finding context provided.');
			return;
		}

		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const activeModel = getOllamaModel(config);
		const conversation = this.conversationManager.createConversation(activeModel, title);

		const injected: ChatMessage = {
			role: 'system',
			content: `Discuss this finding:\n\n${context}`,
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
					'- `@codebase <query>` — Search indexed code snippets by semantic query.',
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
			{
				ragGlobalStoragePath: this.globalStoragePath,
				config,
			},
		);

		if (unresolved.length > 0) {
			this.sendMessageToWebview({ type: 'mentionWarning', mentions: unresolved });
		}

		// Use the cleaned message (without @-tokens) as the actual user question
		const effectiveMessage = cleanedMessage || trimmedContent;

		this.sendMessageToWebview({ type: 'streamStart' });

		let assistantResponse = '';
		try {
			const contextContent = this.buildContextMessage(effectiveMessage, contexts);
			
			const contextMessage: ChatMessage = {
				role: 'system',
				content: contextContent,
				timestamp: Date.now(),
			};

			const history = [
				...this.conversationManager.getHistory(conversation.id),
				contextMessage
			];

			const provider = this.getAIProvider(config);
			assistantResponse = await provider.sendMessage(history, (chunk) => {
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

	private buildContextMessage(
		latestUserMessage: string,
		contexts: ResolvedContext[] = [],
	): string {
		const sections: string[] = [
			'You are an expert software engineer helping with code review follow-ups. You have access to external tools via MCP.',
		];

		if (this.lastInjectedContext) {
			sections.push(`## Additional Context\n${this.lastInjectedContext}`);
		}

		if (contexts.length > 0) {
			const contextLines = contexts.map(c => `### ${c.label}\n${c.content}`).join('\n\n');
			sections.push(`## Context References\n${contextLines}`);
		}

		sections.push(`## Latest User Message\n${latestUserMessage}`);

		return sections.join('\n\n');
	}

	private async handlePickFile(insertOffset: number): Promise<void> {
		const relativePath = await pickWorkspaceFile();
		if (relativePath) {
			this.sendMessageToWebview({ type: 'filePicked', relativePath, insertOffset });
		}
	}

	private getAIProvider(config: vscode.WorkspaceConfiguration): AIProvider {
		const model = getOllamaModel(config);
		const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
		const temperature = config.get<number>('temperature', 0);
		const provider = providerRegistry.resolve(model);
		const requestContext: ProviderRequestContext = {
			config,
			model,
			endpoint,
			temperature,
		};

		const orchestrator = new AgenticChatOrchestrator(
			this.mcpManager,
			provider,
			requestContext
		);

		return {
			sendMessage: async (messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<string> => {
				return orchestrator.chat(messages, {
					onChunk,
					onToolCallStart: (tc) => {
						this.sendMessageToWebview({ type: 'toolCallStart', toolCall: tc });
					},
					onToolCallResult: (id, result) => {
						this.sendMessageToWebview({ type: 'toolCallResult', toolCallId: id, result });
					},
				});
			},
		};
	}

	private getModelOptions(): string[] {
		const config = vscode.workspace.getConfiguration('ollama-code-review');
		return config.get<string[]>('availableModels', DEFAULT_MODELS);
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
		.tool-call {
			margin-top: 8px;
			padding: 8px;
			border-radius: 8px;
			background: color-mix(in srgb, var(--apple-surface) 95%, #ffffff);
			border: 1px solid var(--apple-border);
			font-size: 12px;
		}
		.tool-call.pending {
			border-style: dashed;
			animation: pulse 2s infinite;
		}
		/* Code block actions */
		.code-block-wrapper {
			position: relative;
			margin: 10px 0;
			border-radius: 8px;
			overflow: hidden;
			background: var(--apple-surface-strong);
			border: 1px solid var(--apple-border);
		}
		.code-block-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 4px 8px;
			background: color-mix(in srgb, var(--apple-surface) 95%, #ffffff);
			border-bottom: 1px solid var(--apple-border);
			font-size: 11px;
			color: var(--apple-muted);
		}
		.code-block-actions {
			display: flex;
			gap: 6px;
		}
		.code-block-actions button {
			padding: 2px 6px;
			font-size: 10px;
			font-weight: 500;
			border-radius: 4px;
			background: color-mix(in srgb, var(--apple-surface) 80%, #ffffff);
			color: var(--apple-text);
			border: 1px solid var(--apple-border);
			box-shadow: none;
			min-width: 0;
		}
		.code-block-actions button:hover {
			background: var(--apple-accent);
			color: #fff;
			border-color: var(--apple-accent-strong);
			transform: none;
		}
		.code-block-wrapper pre {
			margin: 0 !important;
			padding: 12px;
			overflow-x: auto;
		}
		@keyframes pulse {
			0% { opacity: 0.7; }
			50% { opacity: 1; }
			100% { opacity: 0.7; }
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
		let renderedMessages = []; // Cache for parsed HTML
		let isStreaming = false;
		let streamingIndex = -1;
		let streamRenderTimer = null;
		let pendingToolCalls = new Map();
		let completedToolCalls = new Map();

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
			if (streamRenderTimer) {
				clearTimeout(streamRenderTimer);
			}
			streamRenderTimer = setTimeout(() => {
				updateStreamingMessage();
				streamRenderTimer = null;
			}, 60);
		}

		// Configure marked with a custom renderer for code blocks
		if (typeof marked !== 'undefined') {
			const renderer = new marked.Renderer();
			
			renderer.code = function(code, language, escaped) {
				const codeStr = typeof code === 'object' ? code.text : code;
				const lang = language || '';
				
				// Modern Base64 encoding for UTF-8 - more efficient for large strings
				const bytes = new TextEncoder().encode(codeStr);
				let binString = "";
				for (let i = 0; i < bytes.length; i++) {
					binString += String.fromCharCode(bytes[i]);
				}
				const encodedCode = btoa(binString);
				
				return [
					'<div class="code-block-wrapper">',
						'<div class="code-block-header">',
							'<span>' + escapeHtml(lang) + '</span>',
							'<div class="code-block-actions">',
								'<button class="action-btn copy-btn" data-code="' + encodedCode + '">Copy</button>',
								'<button class="action-btn insert-btn" data-code="' + encodedCode + '" data-lang="' + escapeHtml(lang) + '">Insert</button>',
								'<button class="action-btn apply-btn" data-code="' + encodedCode + '" data-lang="' + escapeHtml(lang) + '">Apply</button>',
								'<button class="action-btn create-btn" data-code="' + encodedCode + '" data-lang="' + escapeHtml(lang) + '">Create</button>',
							'</div>',
						'</div>',
						'<pre><code class="language-' + escapeHtml(lang) + '">' + escapeHtml(codeStr) + '</code></pre>',
					'</div>'
				].join('');
			};

			marked.setOptions({ renderer });
		}

		function renderHistory() {
			// Ensure cache stays in sync with messages length
			if (renderedMessages.length > messages.length) {
				renderedMessages = renderedMessages.slice(0, messages.length);
			}

			historyEl.innerHTML = '';
			messages.forEach((message, index) => {
				const messageEl = renderMessage(message, index);
				historyEl.appendChild(messageEl);
			});

			// Container for tool calls that are NOT yet part of a message
			const pendingContainer = document.createElement('div');
			pendingContainer.id = 'pending-tool-calls';
			historyEl.appendChild(pendingContainer);
			renderPendingToolCalls();

			historyEl.scrollTop = historyEl.scrollHeight;
		}

		function renderPendingToolCalls() {
			const container = document.getElementById('pending-tool-calls');
			if (!container) return;

			container.innerHTML = '';
			if (pendingToolCalls.size > 0) {
				for (const [id, tc] of pendingToolCalls.entries()) {
					if (!messages.some(m => m.tool_calls?.some(t => t.id === id))) {
						const pendingEl = document.createElement('div');
						pendingEl.className = 'message system';
						pendingEl.innerHTML = '<div class="meta">System</div>' +
							'<div class="tool-call pending">⚙️ Calling ' + tc.function.name + '...</div>';
						container.appendChild(pendingEl);
					}
				}
			}
		}

		function getToolStatusHash(message) {
			if (!message.tool_calls) return '';
			return message.tool_calls.map(tc => {
				const isPending = pendingToolCalls.has(tc.id);
				const result = completedToolCalls.get(tc.id);
				const hasResult = !!result;
				// Include a small hash of the result content if it exists
				const resultHash = result ? JSON.stringify(result).length : 0;
				return tc.id + ':' + (isPending ? 'p' : (hasResult ? 'r' : 'n')) + ':' + resultHash;
			}).join('|');
		}

		function renderMessage(message, index) {
			const statusHash = getToolStatusHash(message);
			// Optimization: Cache rendered HTML for messages that haven't changed
			if (!renderedMessages[index] || 
				renderedMessages[index].content !== message.content || 
				renderedMessages[index].role !== message.role ||
				renderedMessages[index].statusHash !== statusHash
			) {
				let html;
				try {
					const rawContent = message.content || '';
					if (typeof marked !== 'undefined') {
						html = marked.parse(rawContent);
						if (typeof DOMPurify !== 'undefined') {
							html = DOMPurify.sanitize(html, {
								ADD_ATTR: ['data-code', 'data-lang'],
								ADD_TAGS: ['button']
							});
						}
					} else {
						html = '<p>' + escapeHtml(rawContent) + '</p>';
					}
				} catch (e) {
					console.error('Markdown parse error:', e);
					html = '<p>' + escapeHtml(message.content || '') + '</p>';
				}
				renderedMessages[index] = { 
					content: message.content, 
					role: message.role, 
					html: html,
					statusHash: statusHash
				};
			}
			
			const cached = renderedMessages[index];
			const div = document.createElement('div');
			div.className = 'message ' + message.role;
			div.id = 'msg-' + index;

			let toolHtml = '';
			if (message.tool_calls) {
				toolHtml = message.tool_calls.map(tc => {
					const isPending = pendingToolCalls.has(tc.id);
					const result = completedToolCalls.get(tc.id);
					const status = isPending ? '⚙️ Calling' : '✅ Called';
					let resultHtml = '';
					if (result) {
						const json = JSON.stringify(result, null, 2);
						resultHtml = '<details><summary>Result</summary><pre>' + escapeHtml(json) + '</pre></details>';
						// Sanitize the result HTML just in case
						if (typeof DOMPurify !== 'undefined') {
							resultHtml = DOMPurify.sanitize(resultHtml);
						}
					}
					return '<div class="tool-call ' + (isPending ? 'pending' : '') + '">' +
						'<b>' + status + ' ' + tc.function.name + '</b>' +
						resultHtml +
					'</div>';
				}).join('');
			}

			div.innerHTML = '<div class="meta">' + roleLabel(message.role) + '</div>' +
				'<div class="content">' + cached.html + '</div>' +
				toolHtml;
			
			return div;
		}

		function updateStreamingMessage() {
			if (streamingIndex < 0 || !messages[streamingIndex]) return;
			
			const message = messages[streamingIndex];
			const messageEl = document.getElementById('msg-' + streamingIndex);
			
			if (messageEl) {
				const newContentEl = renderMessage(message, streamingIndex);
				messageEl.innerHTML = newContentEl.innerHTML;
			} else {
				// Fallback to full render if element not found
				renderHistory();
			}
			historyEl.scrollTop = historyEl.scrollHeight;
		}

		// Event delegation for code block actions
		historyEl.addEventListener('click', (e) => {
			try {
				const target = e.target;
				if (!target || !(target instanceof HTMLElement) || !target.classList.contains('action-btn')) {
					return;
				}

				const encodedCode = target.getAttribute('data-code');
				if (!encodedCode) return;

				// Modern Base64 decoding for UTF-8
				let code;
				try {
					const binString = atob(encodedCode);
					const bytes = Uint8Array.from(binString, (m) => m.charCodeAt(0));
					code = new TextDecoder().decode(bytes);
				} catch (err) {
					console.error('Failed to decode code block:', err);
					statusEl.textContent = 'Failed to decode code block.';
					setTimeout(() => { statusEl.textContent = ''; }, 3000);
					return;
				}

				// Validation to ensure we're dealing with string data
				if (typeof code !== 'string') {
					return;
				}
				
				const lang = target.getAttribute('data-lang');

				if (target.classList.contains('copy-btn')) {
					vscode.postMessage({ type: 'copyCode', code });
					const originalText = target.textContent;
					target.textContent = 'Copied!';
					setTimeout(() => { target.textContent = originalText; }, 2000);
				} else if (target.classList.contains('insert-btn')) {
					vscode.postMessage({ type: 'insertCode', code, languageId: lang });
				} else if (target.classList.contains('apply-btn')) {
					vscode.postMessage({ type: 'applyCode', code, languageId: lang });
				} else if (target.classList.contains('create-btn')) {
					vscode.postMessage({ type: 'createFile', code });
				}
			} catch (err) {
				console.error('Error in code block action handler:', err);
			}
		});

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
					const msgIndex = messages.length - 1;
					const msgEl = renderMessage(message.message, msgIndex);
					historyEl.insertBefore(msgEl, document.getElementById('pending-tool-calls'));
					historyEl.scrollTop = historyEl.scrollHeight;
					break;
				case 'streamStart':
					setStreaming(true);
					if (streamRenderTimer) {
						clearTimeout(streamRenderTimer);
						streamRenderTimer = null;
					}
					messages.push({ role: 'assistant', content: '', timestamp: Date.now() });
					streamingIndex = messages.length - 1;
					const streamEl = renderMessage(messages[streamingIndex], streamingIndex);
					historyEl.insertBefore(streamEl, document.getElementById('pending-tool-calls'));
					historyEl.scrollTop = historyEl.scrollHeight;
					break;
				case 'streamChunk':
					if (streamingIndex >= 0 && messages[streamingIndex]) {
						messages[streamingIndex].content += message.chunk;
						scheduleStreamRender();
					}
					break;
				case 'streamEnd':
					setStreaming(false);
					if (streamingIndex >= 0) {
						updateStreamingMessage();
					}
					streamingIndex = -1;
					if (!messages.length && message.content) {
						messages.push({ role: 'assistant', content: message.content, timestamp: Date.now() });
						renderHistory();
					}
					inputEl.focus();
					break;
				case 'toolCallStart':
					pendingToolCalls.set(message.toolCall.id, message.toolCall);
					renderPendingToolCalls();
					historyEl.scrollTop = historyEl.scrollHeight;
					break;
				case 'toolCallResult':
					pendingToolCalls.delete(message.toolCallId);
					completedToolCalls.set(message.toolCallId, message.result);
					
					// Find which message this tool call belongs to and update it
					const ownerIndex = messages.findIndex(m => m.tool_calls?.some(tc => tc.id === message.toolCallId));
					if (ownerIndex >= 0) {
						const ownerEl = document.getElementById('msg-' + ownerIndex);
						if (ownerEl) {
							const updatedEl = renderMessage(messages[ownerIndex], ownerIndex);
							ownerEl.innerHTML = updatedEl.innerHTML;
						}
					}
					renderPendingToolCalls();
					break;
				case 'historyCleared':
					messages = [];
					renderedMessages = [];
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
					renderedMessages = [];
					renderHistory();
					break;
				case 'contextInjected':
					statusEl.textContent = 'Context added to this conversation.';
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
