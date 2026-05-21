# Model Context Protocol (MCP)

Ollama Code Review fully supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), enabling seamless integration between VS Code and AI agents like Claude Desktop.

## Built-in MCP Server

The extension includes a built-in MCP server that exposes its code review and context gathering capabilities to external AI tools.

### Key Capabilities
- **Review Tools:** Trigger code reviews, explain changes, and generate summaries.
- **Context Tools:** Resolve imports, find related tests, and search the codebase.
- **File Tools:** Read, write, and list files within the current workspace.
- **Commit Tools:** Generate and apply commit messages.
- **Code Search Tools:** Index repositories, resolve the right indexed codebase, and search related code with Semble.

### Configuration
By default, the built-in server is disabled. You can enable it in your VS Code settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `ollama-code-review.mcp.enabled` | Enable the built-in MCP server | `false` |
| `ollama-code-review.mcp.port` | The port the server listens on | `19840` |
| `ollama-code-review.mcp.autoKillPortConflicts` | Automatically terminate other processes on the MCP port | `false` |
| `ollama-code-review.mcp.allowedOrigins` | Allowed browser origins for companion extensions | `["chrome-extension://*"]` |
| `ollama-code-review.mcp.authToken` | Optional secret token for browser client security | `""` |
| `ollama-code-review.mcp.semble.pythonPath` | Optional Python executable for Semble-backed MCP code search | `""` |

## Semble Code Search

The built-in MCP server can expose Semble-backed semantic code search to MCP clients. This lets an agent search indexed repositories by intent, find related snippets, and inspect index status without reading the entire repository into context.

Indexed repositories are registered in the extension's global storage, so external clients such as Codex, Claude Code, or other MCP-compatible agents can connect to the same VS Code-hosted MCP server and search the repository they are working in. The client should pass `repository_path` on each search call instead of relying on a global active repository.

### Setup

Install Semble in the Python environment used by the extension:

```bash
pip install semble
```

By default, Ollama Code Review launches the Semble worker with `python3` on macOS/Linux and `python` on Windows. If Semble is installed in a virtual environment or custom Python installation, set `ollama-code-review.mcp.semble.pythonPath` to that Python executable.

Example:

```json
{
  "ollama-code-review.mcp.semble.pythonPath": "/Users/me/.venvs/code-search/bin/python"
}
```

### Tools

When MCP is enabled, the server registers these code search tools:

| Tool | Purpose |
|------|---------|
| `index_codebase` | Index a repository and register it for future MCP code search. Defaults to the first open VS Code workspace folder when `repository_path` is omitted. |
| `search_code` | Search an indexed codebase with a natural-language or code query. Pass `repository_path` for explicit multi-repository search. |
| `find_related_code` | Find snippets related to a provided snippet or a file/range seed. |
| `list_indexed_codebases` | Return the registered repositories that MCP clients can present for selection. |
| `resolve_codebase_repository` | Resolve a client working directory to the best matching indexed repository. |
| `get_code_search_status` | Report whether Semble is available and which repositories are available from worker memory and the registry. |

### Recommended Client Flow

For smart clients that know their current working directory:

```json
{
  "working_directory": "/Users/me/projects/api-service"
}
```

Call `resolve_codebase_repository` first. If the response includes `selectedRepositoryPath` and `needsUserSelection` is `false`, pass that path into `search_code`.

```json
{
  "query": "where is webhook signature validation handled",
  "repository_path": "/Users/me/projects/api-service",
  "top_k": 5
}
```

The resolver chooses repositories using this order:

1. Exact path match.
2. Longest indexed ancestor of the working directory.
3. A unique indexed child repository.
4. Otherwise, return candidates and let the client ask the user.

For clients that do not know their working directory, call `list_indexed_codebases`, ask the user to choose, then pass the chosen `repositoryPath` into `search_code` or `find_related_code`.

Example search request:

```json
{
  "query": "where staged diff is filtered before review",
  "repository_path": "/path/to/indexed/repository",
  "top_k": 5
}
```

Example related-code request using a file range:

```json
{
  "file_path": "src/mcp/tools/reviewTools.ts",
  "start_line": 1,
  "end_line": 80,
  "top_k": 5
}
```

### Index Lifecycle

The Semble search index itself is held in the extension's MCP worker process. `index_codebase` creates an in-memory index for the requested repository path. If the worker or extension restarts, the client can still discover previously registered repositories, but the in-memory Semble index may need to be rebuilt on first use or by calling `index_codebase` again.

The worker script itself is written under the extension's VS Code global storage directory in an `mcp/semble_worker.py` file. The indexed-codebase registry is stored in the same global storage area as `mcp/code-search-indexes.json`. Repository index data is not written to the workspace by Ollama Code Review.

### Security Boundaries

When `repository_path` is omitted, code search keeps the legacy behavior and uses the first open VS Code workspace folder. Explicit repository paths outside the current workspace are allowed only after they have been indexed and registered with `index_codebase`.

`find_related_code` can read a file range as the search seed, but only from the selected repository. External MCP clients should pass an explicit `repository_path` for parallel multi-repository workflows so one client's selection does not affect another client.

### Troubleshooting

- If `get_code_search_status` reports Semble as unavailable, confirm that `pip install semble` was run for the Python executable used by the extension.
- If the extension uses the wrong Python environment, set `ollama-code-review.mcp.semble.pythonPath`.
- If `search_code` says a repository is not indexed, call `list_indexed_codebases` to inspect registered repositories or call `index_codebase` with the repository path.
- If search results look stale after large edits, call `index_codebase` again to rebuild the in-memory index.

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
