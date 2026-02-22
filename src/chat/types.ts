export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
	role: ChatRole;
	content: string;
	timestamp: number;
	model?: string;
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
