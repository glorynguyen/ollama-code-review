# Settings Reference

All settings are prefixed with `ollama-code-review.*`.

| Setting | Description | Default |
|---------|-------------|---------|
| `model` | AI model to use (Ollama, Claude, Gemini, etc.) | `custom` |
| `autoSelectModel` | Automatically switch to the best model based on task | `false` |
| `claudeApiKey` | Anthropic API key | `""` |
| `geminiApiKey` | Google AI Studio API key | `""` |
| `mistralApiKey` | Mistral AI API key | `""` |
| `hfApiKey` | Hugging Face API token | `""` |
| `openaiCompatible.endpoint` | Base URL for OpenAI-compatible server | `http://localhost:1234/v1` |
| `endpoint` | Local Ollama instance generate API endpoint | `http://localhost:11434/api/generate` |
| `temperature` | Creativity of the AI response (0.0 to 1.0) | `0` |
| `frameworks` | Target frameworks (e.g., React, Node.js) | `["React"]` |
| `diffFilter.ignorePaths` | Glob patterns for paths to ignore | `node_modules, ...` |
| `preCommitGuard.severityThreshold` | Severity level to block commits | `high` |
| `contextGathering.enabled` | Include related files as context | `true` |
| `notifications.slack.webhookUrl` | Slack webhook URL | `""` |
| `knowledgeBase.enabled` | Enable Team Knowledge Base | `true` |
| `rag.enabled` | Enable RAG context injection | `false` |
| `streaming.enabled` | Enable token-by-token output | `true` |
| `mcp.enabled` | Enable built-in MCP server | `false` |
| `mcp.port` | Port for the built-in MCP server | `19840` |
| `mcp.autoKillPortConflicts` | Automatically kill processes using the MCP port | `false` |
| `mcp.allowedOrigins` | Allowed origins for browser MCP clients | `["chrome-extension://*"]` |
| `mcp.authToken` | Security token for browser MCP clients | `""` |
| `mcp.externalServers` | Configuration for connecting to external MCP servers | `{}` |
| `autoReview.enabled` | Enable background review on file save | `false` |
| `autoReview.minSeverity` | Only notify for findings at or above this level | `high` |
| `contentstack.enabled` | Enable Contentstack schema validation | `false` |
| `contentstack.schemaSource` | Source for schemas (local or api) | `local` |
| `copyFunction.maxDepth` | BFS depth for call-graph expansion in Copy Function with Imports | `3` |
| `copyFunction.maxFunctions` | Max functions to collect in Copy Function with Imports | `15` |
| `copyFunction.maxCharsPerFunction` | Max characters per function body in Copy Function with Imports | `8000` |
| `copyFunction.characterBudget` | Total character budget for all collected functions | `64000` |
| `copyWithImports.noLimits` | Remove all Smart Context limits (use carefully on large files) | `false` |

## Exhaustive List
For the full list of over 50 configuration options, please refer to the VS Code Settings UI by searching for `@ext:VinhNguyen-Vincent.ollama-code-review`.
