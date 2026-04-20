import { callClaudeAPI, isClaudeModel, streamClaudeAPI, chatWithClaude } from '../commands/providerClients';
import { buildProviderPrompt } from './promptFormats';
import type { GenerateOptions, ModelProvider, ProviderRequestContext, StreamOptions, ChatResponse, ChatStreamOptions } from './types';
import type { ChatMessage } from '../chat/types';

export class ClaudeProvider implements ModelProvider {
	public readonly name = 'claude';

	public isMatch(model: string): boolean {
		return isClaudeModel(model);
	}

	public async isAvailable(): Promise<boolean> {
		return true;
	}

	public supportsStreaming(): boolean {
		return true;
	}

	public async generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string> {
		return callClaudeAPI(buildProviderPrompt(prompt, options), context.config, !!options?.captureMetrics);
	}

	public async stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string> {
		return streamClaudeAPI(buildProviderPrompt(prompt, options), context.config, options.onChunk);
	}

	public async streamChat(
		messages: ChatMessage[],
		context: ProviderRequestContext,
		options: ChatStreamOptions
	): Promise<ChatResponse> {
		return chatWithClaude(messages, context.config, {
			tools: options.tools,
			onChunk: options.onChunk,
			onToolCall: options.onToolCall
		});
	}
}
