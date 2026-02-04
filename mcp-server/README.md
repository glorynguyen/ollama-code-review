# Ollama Code Review MCP Server

A Model Context Protocol (MCP) server that provides AI-powered code review prompts for Claude Desktop. This allows you to get code reviews directly in Claude Desktop without copying and pasting diffs.

## Features

- **Code Review Tools**: Review staged changes, specific commits, commit ranges, or branch comparisons
- **Commit Message Generation**: Generate conventional commit messages
- **Code Analysis**: Explain code, suggest refactoring, generate tests, fix issues, generate documentation
- **Agent Skills**: Apply specialized review skills from GitHub repositories
- **Git Integration**: Full git repository access with status, commits, and branches
- **Diff Filtering**: Automatically filters out noise (lock files, generated code, etc.)

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Install from source

```bash
cd mcp-server
npm install
npm run build
```

### Install globally (optional)

```bash
npm install -g .
```

## Configuration with Claude Desktop

Add the server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ollama-code-review": {
      "command": "node",
      "args": ["/path/to/ollama-code-review/mcp-server/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "your-github-token-optional",
        "CODE_REVIEW_FRAMEWORKS": "React,TypeScript,Node.js",
        "CODE_REVIEW_WORKING_DIR": "/path/to/default/repo"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "ollama-code-review": {
      "command": "ollama-code-review-mcp"
    }
  }
}
```

After updating the config, restart Claude Desktop.

## Available Tools

### Code Review Tools

| Tool | Description |
|------|-------------|
| `review_staged_changes` | Review staged git changes |
| `review_commit` | Review a specific commit by hash |
| `review_commit_range` | Review changes between two commits |
| `review_branches` | Compare two branches |
| `generate_commit_message` | Generate a conventional commit message |

### Code Analysis Tools

| Tool | Description |
|------|-------------|
| `explain_code` | Get a detailed explanation of code |
| `suggest_refactoring` | Get improvement suggestions |
| `generate_tests` | Generate unit tests |
| `fix_code` | Fix issues in code |
| `generate_documentation` | Generate JSDoc/TSDoc/docstrings |

### Skills Management

| Tool | Description |
|------|-------------|
| `list_skills` | List available agent skills |
| `select_skills` | Select skills for reviews |
| `clear_skills` | Clear selected skills |

### Git Information

| Tool | Description |
|------|-------------|
| `get_git_status` | Get repository status |
| `list_commits` | List recent commits |
| `list_branches` | List branches |

## Usage Examples

### Review Staged Changes

In Claude Desktop, you can ask:

> "Review my staged changes in /path/to/my/project"

Claude will use the `review_staged_changes` tool and provide a detailed code review.

### Review with Skills

> "First list available skills, then select 'security-review' and 'performance-review', then review my staged changes"

This applies specialized review guidelines to your code review.

### Generate Commit Message

> "Generate a commit message for my staged changes"

Returns a conventional commit message based on your diff.

### Compare Branches

> "Review the changes between main and feature/my-branch in my project"

Provides a review of all changes in your feature branch.

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub token for skill fetching (avoids rate limits) |
| `CODE_REVIEW_FRAMEWORKS` | Comma-separated list of frameworks |
| `CODE_REVIEW_WORKING_DIR` | Default repository path |

### Config File

Create `~/.config/ollama-code-review-mcp/config.json`:

```json
{
  "frameworks": ["React", "TypeScript", "Node.js"],
  "skillRepositories": ["vercel-labs/agent-skills"],
  "diffFilter": {
    "ignorePaths": ["node_modules/**", "dist/**"],
    "ignorePatterns": ["*.min.js", "*.map"],
    "maxFileLines": 500,
    "ignoreFormattingOnly": false
  }
}
```

## Resources

The server exposes these resources that Claude can read:

- `config://settings` - Current server configuration
- `skills://selected` - Currently selected skills
- `skills://downloaded` - All cached skills

## Prompts

Pre-built prompts available:

- `code_review` - Review diff with framework context
- `commit_message` - Generate commit message from diff

## Development

```bash
# Watch mode
npm run watch

# Development with tsx
npm run dev

# Build
npm run build
```

## Architecture

```
mcp-server/
├── src/
│   ├── index.ts       # MCP server entry point
│   ├── prompts.ts     # Prompt templates
│   ├── skills.ts      # Skills service
│   ├── git.ts         # Git operations
│   ├── diffFilter.ts  # Diff filtering
│   └── config.ts      # Configuration management
├── package.json
└── tsconfig.json
```

## License

MIT
