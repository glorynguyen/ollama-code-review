import type * as vscode from 'vscode';
import type { ChatMessage, Conversation } from './types';

const CONVERSATIONS_KEY = 'ai-review.chat.conversations';
const ACTIVE_CONVERSATION_KEY = 'ai-review.chat.activeConversationId';

export class ConversationManager implements vscode.Disposable {
	private conversations: Conversation[];
	private activeConversationId: string | undefined;
	private persistTimer: NodeJS.Timeout | undefined;

	constructor(private readonly memento: vscode.Memento) {
		this.conversations = this.memento.get<Conversation[]>(CONVERSATIONS_KEY, []);
		this.activeConversationId = this.memento.get<string | undefined>(ACTIVE_CONVERSATION_KEY);
	}

	public createConversation(modelId: string, title = 'New Chat'): Conversation {
		const conversation: Conversation = {
			id: this.createId(),
			title,
			messages: [],
			modelId,
		};

		this.conversations.unshift(conversation);
		this.activeConversationId = conversation.id;
		this.schedulePersist();
		return conversation;
	}

	public addMessage(conversationId: string, message: ChatMessage): Conversation | undefined {
		const conversation = this.findConversation(conversationId);
		if (!conversation) {
			return undefined;
		}

		conversation.messages.push(message);
		if (conversation.title === 'New Chat' && message.role === 'user') {
			conversation.title = this.createTitle(message.content);
		}

		this.activeConversationId = conversation.id;
		this.schedulePersist();
		return conversation;
	}

	public getHistory(conversationId?: string): ChatMessage[] {
		const id = conversationId ?? this.activeConversationId;
		if (!id) {
			return [];
		}

		return [...(this.findConversation(id)?.messages ?? [])];
	}

	public clearHistory(conversationId?: string): Conversation | undefined {
		const id = conversationId ?? this.activeConversationId;
		if (!id) {
			return undefined;
		}

		const conversation = this.findConversation(id);
		if (!conversation) {
			return undefined;
		}

		conversation.messages = [];
		this.schedulePersist();
		return conversation;
	}

	public getActiveConversation(): Conversation | undefined {
		if (!this.activeConversationId) {
			return undefined;
		}
		return this.findConversation(this.activeConversationId);
	}

	public getOrCreateActiveConversation(modelId: string): Conversation {
		const active = this.getActiveConversation();
		if (active) {
			if (active.modelId !== modelId) {
				active.modelId = modelId;
				this.schedulePersist();
			}
			return active;
		}
		return this.createConversation(modelId);
	}

	public setActiveConversation(conversationId: string): Conversation | undefined {
		const conversation = this.findConversation(conversationId);
		if (!conversation) {
			return undefined;
		}
		this.activeConversationId = conversationId;
		this.schedulePersist();
		return conversation;
	}

	public updateModel(conversationId: string, modelId: string): Conversation | undefined {
		const conversation = this.findConversation(conversationId);
		if (!conversation) {
			return undefined;
		}
		conversation.modelId = modelId;
		this.schedulePersist();
		return conversation;
	}

	private findConversation(conversationId: string): Conversation | undefined {
		return this.conversations.find((item) => item.id === conversationId);
	}

	private createId(): string {
		return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
	}

	private createTitle(content: string): string {
		const normalized = content.replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return 'New Chat';
		}
		return normalized.slice(0, 60);
	}

	private schedulePersist(): void {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
		}
		this.persistTimer = setTimeout(() => {
			void this.persist();
		}, 250);
	}

	private async persist(): Promise<void> {
		await this.memento.update(CONVERSATIONS_KEY, this.conversations);
		await this.memento.update(ACTIVE_CONVERSATION_KEY, this.activeConversationId);
	}

	public dispose(): void {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
		}
	}
}
