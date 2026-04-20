import * as vscode from 'vscode';
import type { ChatMessage, ToolCall } from './types';
import type { ModelProvider, ProviderRequestContext, ChatStreamOptions, ChatResponse } from '../providers/types';
import type { McpClientManager, McpTool } from '../mcp/mcpClientManager';

export interface OrchestratorOptions {
	onChunk: (chunk: string) => void;
	onToolCallStart: (toolCall: ToolCall) => void;
	onToolCallResult: (toolCallId: string, result: unknown) => void;
}

export class AgenticChatOrchestrator {
	constructor(
		private readonly mcpManager: McpClientManager,
		private readonly provider: ModelProvider,
		private readonly context: ProviderRequestContext
	) {}

	/**
	 * Run the agentic chat loop.
	 * 1. Fetch available tools.
	 * 2. Send messages to LLM.
	 * 3. If LLM returns tool calls, execute them and repeat.
	 * 4. Return the final natural language response.
	 */
	public async chat(
		messages: ChatMessage[],
		options: OrchestratorOptions
	): Promise<string> {
		let history = [...messages];
		const tools = await this.mcpManager.getAllTools();

		let loopCount = 0;
		const config = vscode.workspace.getConfiguration('ollama-code-review.chat');
		const maxLoops = config.get<number>('agentMaxLoops', 10);

		while (loopCount < maxLoops) {
			loopCount++;

			const chatOptions: ChatStreamOptions = {
				onChunk: options.onChunk,
				tools: tools,
			};

			let response: ChatResponse;
			if (this.provider.streamChat) {
				response = await this.provider.streamChat(history, this.context, chatOptions);
			} else if (this.provider.chat) {
				response = await this.provider.chat(history, this.context, chatOptions);
				// Call onChunk for the full content to show it in the UI
				options.onChunk(response.content);
			} else {
				// Fallback to basic stream if chat is not implemented
				// This won't support tools, but maintains backward compatibility
				// For non-chat models, we build a simple history string for the last few messages
				const recentHistory = history.slice(-5);
				const prompt = recentHistory.map(m => {
					const role = m.role === 'user' ? 'User' : (m.role === 'assistant' ? 'Assistant' : 'System');
					return `${role}: ${m.content}`;
				}).join('\n\n') + '\n\nAssistant:';
				
				const content = await this.provider.stream(prompt, this.context, { onChunk: options.onChunk });
				return content;
			}

			// Add assistant message to history
			history.push({
				role: 'assistant',
				content: response.content,
				timestamp: Date.now(),
				tool_calls: response.tool_calls,
			});

			if (!response.tool_calls || response.tool_calls.length === 0) {
				return response.content;
			}

			// Handle tool calls in parallel for performance.
			// Note: This assumes tool calls are independent (e.g., they don't depend on each other's side effects).
			// If tools are dependent, they should be called serially or the model should be instructed to chain them.
			const toolResults = await Promise.all(
				response.tool_calls.map(async (tc) => {
					options.onToolCallStart(tc);

					try {
						const toolDef = tools.find((t) => t.name === tc.function.name);
						if (!toolDef) {
							throw new Error(`Tool "${tc.function.name}" not found.`);
						}

						let args: Record<string, unknown>;
						try {
							const parsed = JSON.parse(tc.function.arguments);
							if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
								throw new Error('Arguments must be a JSON object');
							}
							args = parsed as Record<string, unknown>;
						} catch (parseError: any) {
							throw new Error(`Invalid JSON arguments for tool "${tc.function.name}": ${parseError?.message || parseError}`);
						}

						// Basic validation: Check if required fields exist if the schema defines them
						if (toolDef.inputSchema?.required && Array.isArray(toolDef.inputSchema.required)) {
							for (const field of toolDef.inputSchema.required) {
								if (args[field] === undefined) {
									throw new Error(`Missing required argument "${field}" for tool "${tc.function.name}"`);
								}
							}
						}

						const result = await this.mcpManager.callTool(toolDef.serverName, tc.function.name, args);

						options.onToolCallResult(tc.id, result);

						let content = typeof result === 'string' ? result : JSON.stringify(result);
						const MAX_TOOL_OUTPUT = 50000;
						if (content.length > MAX_TOOL_OUTPUT) {
							content = content.substring(0, MAX_TOOL_OUTPUT) + `\n\n[Output truncated from ${content.length} characters to ${MAX_TOOL_OUTPUT} for performance]`;
						}

						return {
							role: 'tool' as const,
							tool_call_id: tc.id,
							content,
							timestamp: Date.now(),
						};
					} catch (error: any) {
						const errorMsg = error?.message || String(error);
						options.onToolCallResult(tc.id, { error: errorMsg });
						return {
							role: 'tool' as const,
							tool_call_id: tc.id,
							content: JSON.stringify({ error: errorMsg }),
							timestamp: Date.now(),
						};
					}
				})
			);

			// Add tool results to history and continue loop
			history.push(...toolResults);

			// Keep history size manageable (optional, but good for token limits)
			history = this.truncateHistory(history);
		}

		throw new Error('Maximum agent loops exceeded.');
	}

	private truncateHistory(history: ChatMessage[]): ChatMessage[] {
		if (history.length <= 50) {
			return history;
		}
		
		// Keep all system messages as they usually contain critical instructions or context
		const systemMessages = history.filter(m => m.role === 'system');
		// Keep the last 30 non-system messages to maintain recent conversation flow
		const nonSystemMessages = history.filter(m => m.role !== 'system');
		const recentMessages = nonSystemMessages.slice(-30);

		const newHistory = [...systemMessages, ...recentMessages];
		
		// Use original indices as secondary sort key for stability with same timestamps
		const indexMap = new Map(history.map((m, i) => [m, i]));
		return newHistory.sort((a, b) => {
			const timeDiff = a.timestamp - b.timestamp;
			if (timeDiff !== 0) { return timeDiff; }
			return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
		});
	}
}
