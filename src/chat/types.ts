export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatMessage {
	role: ChatRole;
	content: string;
	timestamp: number;
	model?: string;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

export interface Conversation {
	id: string;
	title: string;
	messages: ChatMessage[];
	modelId: string;
}

export type WebviewInboundMessage =
	| { type: 'ready' }
	| { type: 'sendMessage'; content: string }
	| { type: 'setModel'; modelId: string }
	| { type: 'newConversation' }
	| { type: 'clearHistory' }
	| { type: 'applyCode'; code: string; languageId?: string }
	| { type: 'insertCode'; code: string; languageId?: string }
	| { type: 'copyCode'; code: string }
	| { type: 'createFile'; code: string }
	/** Sent when the user selects @file from the mention dropdown. Extension opens a VS Code file picker. */
	| { type: 'pickFile'; insertOffset: number };

export type WebviewOutboundMessage =
	| {
		type: 'hydrate';
		conversation: Conversation;
		availableModels: string[];
		activeModel: string;
	}
	| { type: 'messageAdded'; message: ChatMessage }
	| { type: 'streamStart' }
	| { type: 'streamChunk'; chunk: string }
	| { type: 'streamEnd'; content: string }
	| { type: 'toolCallStart'; toolCall: ToolCall }
	| { type: 'toolCallResult'; toolCallId: string; result: unknown }
	| { type: 'historyCleared' }
	| { type: 'modelUpdated'; modelId: string }
	| { type: 'conversationCreated'; conversation: Conversation }
	| { type: 'contextInjected'; context: string }
	| { type: 'error'; error: string }
	/** Sent after a file is picked; webview inserts the relative path into the input. */
	| { type: 'filePicked'; relativePath: string; insertOffset: number }
	/** Sent to notify the webview that one or more @-mentions could not be resolved. */
	| { type: 'mentionWarning'; mentions: string[] };

export type WebviewMessage = WebviewInboundMessage | WebviewOutboundMessage;
