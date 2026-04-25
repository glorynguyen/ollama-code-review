# AI Review Chat

Interact with the AI using a dedicated, persistent chat interface directly in VS Code.

## Persistent Chat Sidebar

The AI Review Chat is always accessible from the VS Code Activity Bar (`$(comment-discussion)` icon).

- **Conversation History:** Your chats are saved and persist across VS Code sessions.
- **Discuss Button:** After any code review, click the **💬 Discuss** button to send the full review into the sidebar for follow-up questions.
- **Agentic Editing:** When using models like Claude 3.7 or v0, the AI can autonomously edit files in your workspace (after your confirmation).

## @-Context Mentions

Type `@` in the chat input to instantly inject rich context into your conversation.

| Mention | Description |
|---------|-------------|
| `@file` | Include a specific file from your workspace. |
| `@diff` | Include the current staged git changes. |
| `@selection` | Include the text currently selected in the editor. |
| `@review` | Include the most recent AI code review. |
| `@knowledge` | Include entries from your Team Knowledge Base. |

## Chat Commands

Use slash commands for quick actions:

- `/staged`: Load the currently staged git diff as context.
- `/help`: Show all available chat commands.
