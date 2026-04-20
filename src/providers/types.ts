import * as vscode from 'vscode';
import type { ChatMessage, ToolCall } from '../chat/types';
import type { McpTool } from '../mcp/mcpClientManager';

export type ResponseFormat = 'text' | 'structured-review';

export interface GenerateOptions {
	captureMetrics?: boolean;
	responseFormat?: ResponseFormat;
}

export interface StreamOptions extends GenerateOptions {
	onChunk: (text: string) => void;
}

export interface ChatResponse {
	content: string;
	tool_calls?: ToolCall[];
}

export interface ChatStreamOptions extends GenerateOptions {
	onChunk: (chunk: string) => void;
	onToolCall?: (toolCall: ToolCall) => void;
	tools?: McpTool[];
}

export interface ProviderRequestContext {
	config: vscode.WorkspaceConfiguration;
	model: string;
	endpoint: string;
	temperature: number;
}

export interface ModelProvider {
	readonly name: string;
	isMatch(model: string): boolean;
	isAvailable(): Promise<boolean>;
	supportsStreaming(): boolean;
	generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string>;
	/**
	 * Streaming contract:
	 * - Providers with native streaming should emit incremental chunks through `options.onChunk`.
	 * - Providers without native streaming may generate the full response then emit one chunk.
	 * - Errors are expected to bubble to the caller so UI layers can handle termination consistently.
	 */
	stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string>;

	/**
	 * Agentic Chat contract:
	 * - Handles message history and tool definitions.
	 */
	chat?(
		messages: ChatMessage[],
		context: ProviderRequestContext,
		options?: ChatStreamOptions
	): Promise<ChatResponse>;

	streamChat?(
		messages: ChatMessage[],
		context: ProviderRequestContext,
		options: ChatStreamOptions
	): Promise<ChatResponse>;
}
