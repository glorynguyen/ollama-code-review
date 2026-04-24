import { callV0API, isV0Model } from '../commands/providerClients';
import { buildProviderPrompt } from './promptFormats';
import { extractToolCalls, generateToolCallId } from '../utils';
import type { GenerateOptions, ModelProvider, ProviderRequestContext, StreamOptions, ChatResponse, ChatStreamOptions } from './types';
import type { ChatMessage } from '../chat/types';

export class V0Provider implements ModelProvider {
	public readonly name = 'v0';

	public isMatch(model: string): boolean {
		return isV0Model(model);
	}

	public async isAvailable(): Promise<boolean> {
		return true;
	}

	public supportsStreaming(): boolean {
		return false;
	}

	public async generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string> {
		return callV0API(buildProviderPrompt(prompt, options), context.config, !!options?.captureMetrics);
	}

	public async stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string> {
		const full = await this.generate(prompt, context, options);
		options.onChunk(full);
		return full;
	}

	public async streamChat(
		messages: ChatMessage[],
		context: ProviderRequestContext,
		options: ChatStreamOptions
	): Promise<ChatResponse> {
		// V0 doesn't support chat history or tools natively yet, so we combine into a prompt
		let prompt = '';

		// 1. System instructions first
		const systemMessages = messages.filter(m => m.role === 'system');
		if (systemMessages.length > 0) {
			prompt += systemMessages.map(m => m.content).join('\n\n') + '\n\n';
		}

		// 2. Tool definitions
		if (options.tools?.length) {
			prompt += 'Mandatory Assistant Capabilities:\n';
			prompt += 'You have access to MCP tools to interact with the user\'s workspace. Use them whenever you need to read, create, or modify files.\n\n';
			prompt += 'Available MCP tools:\n' + options.tools.map(t => 
				`- ${t.name}: ${t.description}\n  Schema: ${JSON.stringify(t.inputSchema)}`
			).join('\n') + '\n\n';
			prompt += 'To call a tool, you MUST output a JSON block like this:\n';
			prompt += '{"tool": "toolName", "args": {...}}\n\n';
			prompt += 'If the user asks you to "create a file", "save this code", or "update a file", ALWAYS use the `write_file` or `update_file` tool. Do NOT just output the code block.\n\n';
		}

		// 3. Conversation history (excluding system messages)
		prompt += messages.filter(m => m.role !== 'system').map(m => {
			const sanitizedContent = m.content.replace(/^(USER|ASSISTANT|SYSTEM|TOOL):/i, '[$1]:');
			return `${m.role.toUpperCase()}: ${sanitizedContent}`;
		}).join('\n');
		
		const fullText = await this.generate(prompt, context, options);
		options.onChunk(fullText);

		// Extract tool calls
		const extracted = extractToolCalls(fullText);
		const toolCalls = extracted.map(tc => ({
			id: generateToolCallId(),
			type: 'function' as const,
			function: {
				name: tc.name,
				arguments: tc.arguments,
			}
		}));

		return { content: fullText, tool_calls: toolCalls.length ? toolCalls : undefined };
	}
}
