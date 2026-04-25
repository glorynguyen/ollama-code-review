# Collaboration & Integrations

Connect Ollama Code Review to your team's existing tools and workflows.

## Notification Integrations

Automatically post review summaries to your team communication channels.

| Platform | Format |
|----------|--------|
| **Slack** | Block Kit message with findings summary and quality score. |
| **MS Teams** | MessageCard with a facts table of findings. |
| **Discord** | Embed with severity-colored border. |

- **Setup:** Create an incoming webhook for your platform and paste the URL into the corresponding setting (e.g., `ollama-code-review.notifications.slack.webhookUrl`).
- **Triggering:** Use `ollama-code-review.notifications.triggerOn` to control which severity levels trigger a notification.

## GitHub, GitLab & Bitbucket

Review Pull Requests or Merge Requests directly from VS Code.

- **Commands:** `Review GitHub PR`, `Review GitLab MR`, `Review Bitbucket PR`.
- **Posting Comments:** Use the "Post Review" commands to publish the AI's feedback directly as PR/MR comments.
- **Authentication:** Supports CLI tools (`gh`, `glab`), VS Code accounts, or manual API tokens.

## Browser Extension (Companion)

The **OCR Browser Review** extension allows you to review GitHub PRs and GitLab MRs directly in your browser.

- **Local Context:** It connects to your VS Code MCP server to fetch repository-specific context.
- **Privacy:** Uses WebLLM + WebGPU to run AI models directly in your browser.
- **Setup:** Enable the MCP server in VS Code (`ollama-code-review.mcp.enabled`) and install the companion extension in Chrome.

## MCP Server

The extension includes a built-in **Model Context Protocol (MCP)** server.

- **Use Case:** Allows external tools like Claude Code or the OCR Browser Extension to access your local workspace context (diffs, files, branches).
- **Control:** You can configure the port, allowed origins, and authentication tokens for the server.
