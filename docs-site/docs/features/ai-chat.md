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
- `/gather <question>`: Harvest relevant codebase context for a question and copy a paste-ready prompt to the clipboard.

### /gather — Smart Codebase Context Harvester

`/gather` searches your workspace for files relevant to a plain-English question and assembles a self-contained prompt (question + file contents) that you can paste directly into Claude, Gemini, or any external LLM.

**Usage:**

```
/gather What is the billboard split screen feature?
/gather How does authentication work in this project?
/gather Where is the data-fetching logic for the dashboard?
```

**How it works:**

1. **Keyword extraction** — meaningful terms are pulled from your question (stopwords removed, camelCase and PascalCase variants generated for class/file name matching).
2. **Semantic search (Strategy A)** — if the workspace has been [indexed for RAG](../features/rag.md), similar code chunks are retrieved by embedding similarity.
3. **Filename search (Strategy B)** — files whose names match the extracted keywords are scored and collected.
4. **Content search (Strategy C)** — when fewer than 5 candidates are found, all workspace source files are scanned for keyword matches.
5. **Budget & dedup** — results are deduplicated (same file from multiple strategies keeps the highest-relevance entry), capped at 10 files / ~30 000 characters, and ordered: semantic results first, then filename matches, then content matches.
6. **Clipboard copy** — the assembled prompt is written to your clipboard; a confirmation message shows the file count, approximate size, and which strategies fired.

**Result in chat:**

```
✅ Context copied to clipboard!
3 file(s) · ~12.4k chars via semantic (2 snippets) + filename (1 file)

Paste directly into Claude, Gemini, or any LLM — the question and all
relevant file contents are included.
```

:::tip Enable RAG for best results
Run **Ollama: Index Codebase for RAG** once to build a semantic index. `/gather` will then use embedding-based search (Strategy A) in addition to filename and content matching, giving significantly more accurate results for abstract questions.
:::

:::note No question provided
Typing `/gather` without a question displays usage instructions instead of searching.
:::
