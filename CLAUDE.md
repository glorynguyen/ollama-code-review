# Ollama Code Review - Project Knowledge Base

## Project Overview

- **Name:** Ollama Code Review VS Code Extension
- **Version:** 1.9.0
- **Purpose:** AI-powered code reviews and commit message generation using local Ollama or cloud models
- **Author:** Vinh Nguyen (vincent)
- **License:** MIT
- **Repository:** https://github.com/glorynguyen/ollama-code-review.git

## Tech Stack

- **Language:** TypeScript 5.9.2
- **Framework:** VS Code Extension API (requires VS Code 1.102.0+)
- **HTTP Client:** Axios 1.11.0
- **GitHub API:** @octokit/rest 22.0.1
- **Build:** Webpack + TypeScript Compiler
- **Linting:** ESLint 9.32.0
- **Release:** semantic-release 25.0.2

## Project Structure

```
src/
├── extension.ts          # Main entry point (commands, Git integration, model selection)
├── reviewProvider.ts     # Webview panel for review results & interactive chat
├── skillsService.ts      # Agent skills download/caching from GitHub
├── skillsBrowserPanel.ts # Skills browser UI webview
├── utils.ts              # Config helper functions
└── test/
    └── extension.test.ts # Mocha test suite

out/                      # Compiled JavaScript output
.github/workflows/        # CI/CD (semantic-release)
```

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/extension.ts` | ~1,024 | Main extension logic, all commands, Git operations |
| `src/reviewProvider.ts` | ~196 | Webview for displaying reviews with chat interface |
| `src/skillsService.ts` | ~204 | Fetches/caches agent skills from GitHub repos |
| `src/skillsBrowserPanel.ts` | ~255 | UI for browsing and downloading skills |
| `src/utils.ts` | ~9 | Helper for resolving model configuration |

## Commands

| Command ID | Description |
|------------|-------------|
| `ollama-code-review.selectModel` | Pick AI model (cloud/local Ollama) |
| `ollama-code-review.reviewChanges` | Review staged Git changes |
| `ollama-code-review.reviewCommit` | Review a specific commit |
| `ollama-code-review.reviewCommitRange` | Review a range of commits |
| `ollama-code-review.reviewChangesBetweenTwoBranches` | Compare two branches |
| `ollama-code-review.generateCommitMessage` | Auto-generate conventional commit message |
| `ollama-code-review.suggestRefactoring` | Code suggestions via lightbulb/context menu |
| `ollama-code-review.browseAgentSkills` | Browse and download agent skills |
| `ollama-code-review.applySkillToReview` | Apply a skill to reviews |

## Configuration Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ollama-code-review.model` | `kimi-k2.5:cloud` | Model selection |
| `ollama-code-review.customModel` | `""` | Custom model name |
| `ollama-code-review.claudeApiKey` | `""` | Anthropic API key for Claude models |
| `ollama-code-review.endpoint` | `http://localhost:11434/api/generate` | Ollama API endpoint |
| `ollama-code-review.temperature` | `0` | Model temperature (0-1) |
| `ollama-code-review.frameworks` | `["React"]` | Target frameworks for context |
| `ollama-code-review.skills.defaultRepository` | `vercel-labs/agent-skills` | GitHub repo for skills |
| `ollama-code-review.skills.autoApply` | `true` | Auto-apply selected skill |

## Supported Models

### Cloud Models (No local setup required)
- `kimi-k2.5:cloud` - Kimi cloud model (Default)
- `qwen3-coder:480b-cloud` - Cloud coding model
- `glm-4.7:cloud` - GLM cloud model

### Claude Models (Requires Anthropic API key)
- `claude-sonnet-4-20250514` - Claude Sonnet 4
- `claude-opus-4-20250514` - Claude Opus 4
- `claude-3-7-sonnet-20250219` - Claude 3.7 Sonnet

### Local Ollama Models
Any model available in your local Ollama instance will be auto-discovered.

## Architecture

### Extension Activation
1. Activates on: JS/TS/JSX/TSX files or SCM view
2. Entry: `activate()` in `extension.ts`
3. Registers all commands and status bar items

### API Endpoints Used
- **Generate:** `{endpoint}/api/generate` - Reviews, commit messages, suggestions
- **Chat:** `{endpoint}/api/chat` - Interactive follow-up questions
- **Tags:** `{endpoint}/api/tags` - List available local models

### Git Integration
- Uses VS Code's built-in Git extension API
- Supports: staged changes, commit diffs, branch comparisons
- Multi-repository workspace support

### Webview Panels
- **Review Panel:** Displays markdown reviews with highlight.js, supports chat
- **Skills Browser:** Lists/downloads skills with search filtering

## Key Functions in extension.ts

- `activate()` - Extension entry, command registration
- `runReview()` - Execute code review workflow
- `getOllamaReview()` - Call Ollama API for review
- `getOllamaCommitMessage()` - Generate commit message
- `getOllamaSuggestion()` - Get code suggestions
- `selectRepository()` - Handle multi-repo workspaces
- `runGitCommand()` - Execute git operations

## Build Commands

```bash
yarn compile    # Compile TypeScript
yarn build      # Lint + compile
yarn watch      # Watch mode
yarn test       # Run tests
yarn package    # Build VSIX
yarn release    # Semantic release
```

## Agent Skills System

- Skills fetched from GitHub (default: vercel-labs/agent-skills)
- Cached locally in extension global storage
- YAML frontmatter parsed for metadata
- Can be applied to enhance review prompts

## Notes

- Cloud models available as fallback when local Ollama unreachable
- Conventional Commits format for generated messages
- Status bar shows current model with click-to-switch
- Reviews support follow-up questions via chat interface
