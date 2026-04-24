# Model Context Protocol (MCP)

Ollama Code Review fully supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), enabling seamless integration between VS Code and AI agents like Claude Desktop.

## Built-in MCP Server

The extension includes a built-in MCP server that exposes its code review and context gathering capabilities to external AI tools.

### Key Capabilities
- **Review Tools:** Trigger code reviews, explain changes, and generate summaries.
- **Context Tools:** Resolve imports, find related tests, and search the codebase.
- **File Tools:** Read, write, and list files within the current workspace.
- **Commit Tools:** Generate and apply commit messages.

### Configuration
By default, the built-in server is disabled. You can enable it in your VS Code settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `ollama-code-review.mcp.enabled` | Enable the built-in MCP server | `false` |
| `ollama-code-review.mcp.port` | The port the server listens on | `19840` |
| `ollama-code-review.mcp.autoKillPortConflicts` | Automatically terminate other processes on the MCP port | `false` |
| `ollama-code-review.mcp.allowedOrigins` | Allowed browser origins for companion extensions | `["chrome-extension://*"]` |
| `ollama-code-review.mcp.authToken` | Optional secret token for browser client security | `""` |

### Integration with Claude Desktop
To use this extension with Claude Desktop, add the following to your `claude_desktop_config.json`. This uses `mcp-remote` to bridge the extension's HTTP server to Claude's Stdio client:

```json
{
  "mcpServers": {
    "ollama-code-review": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:19840/mcp",
        "--allow-http"
      ]
    }
  }
}
```

## External MCP Servers

You can also connect Ollama Code Review to *other* MCP servers. This allows the extension's AI to use tools provided by those servers during its review process.

### Configuration
Add external servers via the `ollama-code-review.mcp.externalServers` setting:

```json
"ollama-code-review.mcp.externalServers": {
  "sqlite-explorer": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db", "path/to/your.db"]
  }
}
```

## MCP Mode (Clipboard)

When `mcp.enabled` is set to `true`, the extension changes its behavior for manual review triggers:
Instead of sending the review request to an LLM directly, it **copies the full review prompt to your clipboard**. 

This is designed for workflows where you want to manually paste the context into an external chat interface (like Claude.ai or ChatGPT) that is also using the MCP server.
