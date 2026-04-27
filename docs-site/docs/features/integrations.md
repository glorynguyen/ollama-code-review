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

## Git Providers (PR/MR Reviews)

Review Pull Requests or Merge Requests directly from VS Code and post AI feedback as comments.

### GitHub
- **Authentication:** Automatically uses the `gh` CLI or your VS Code GitHub account. Alternatively, set `ollama-code-review.github.token`.
- **Comment Styles:** Choose between `summary` (one top-level comment) or `inline` (comments on specific lines) via `ollama-code-review.github.commentStyle`.

### GitLab
- **Authentication:** Uses the `glab` CLI or a Personal Access Token (`ollama-code-review.gitlab.token`) with `api` scope.
- **Self-Hosted:** Configure `ollama-code-review.gitlab.baseUrl` for your own instance.

### Bitbucket
- **Authentication:** Uses Bitbucket App Passwords. Set your username and app password in `ollama-code-review.bitbucket.username` and `ollama-code-review.bitbucket.appPassword`.
- **Scopes:** Requires `Pullrequests: Read` and `Pullrequests: Write`.

## Azure DevOps (ADO)

The extension integrates with Azure DevOps primarily through the **AI Release Orchestrator**.

- **Authentication:** Set your Personal Access Token (PAT) using the command `Ollama Code Review: Set ADO Token`.
- **Scopes:** Requires `Work Items: Read` and `Code: Read/Write` (for cherry-picking).
- **Configuration:** Set your Organization URL and Project name in `ollama-code-review.ado.orgUrl` and `ollama-code-review.ado.project`.

## Browser Extension (Companion)

The **OCR Browser Review** extension allows you to review GitHub PRs and GitLab MRs directly in your browser.

- **Local Context:** It connects to your VS Code MCP server to fetch repository-specific context.
- **Privacy:** Uses WebLLM + WebGPU to run AI models directly in your browser.
- **Setup:** Enable the MCP server in VS Code (`ollama-code-review.mcp.enabled`) and install the companion extension in Chrome.

## MCP Server

The extension includes a built-in **Model Context Protocol (MCP)** server.

- **Use Case:** Allows external tools like Claude Code or the OCR Browser Extension to access your local workspace context (diffs, files, branches).
- **Control:** You can configure the port, allowed origins, and authentication tokens for the server.
