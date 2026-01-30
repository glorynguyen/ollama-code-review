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
| `ollama-code-review.glmApiKey` | `""` | Z.AI (BigModel/Zhipu) API key for GLM models |
| `ollama-code-review.hfApiKey` | `""` | Hugging Face API token for HF Inference API |
| `ollama-code-review.hfModel` | `Qwen/Qwen2.5-Coder-7B-Instruct` | Hugging Face model name |
| `ollama-code-review.hfPopularModels` | (see below) | Popular HF models for quick selection |
| `ollama-code-review.geminiApiKey` | `""` | Google AI Studio API key for Gemini models |
| `ollama-code-review.mistralApiKey` | `""` | Mistral AI API key for Mistral models |
| `ollama-code-review.endpoint` | `http://localhost:11434/api/generate` | Ollama API endpoint |
| `ollama-code-review.temperature` | `0` | Model temperature (0-1) |
| `ollama-code-review.frameworks` | `["React"]` | Target frameworks for context |
| `ollama-code-review.skills.defaultRepository` | `vercel-labs/agent-skills` | GitHub repo for skills |
| `ollama-code-review.skills.autoApply` | `true` | Auto-apply selected skill |

## Supported Models

### Cloud Models (No local setup required)
- `kimi-k2.5:cloud` - Kimi cloud model (Default)
- `qwen3-coder:480b-cloud` - Cloud coding model
- `glm-4.7:cloud` - GLM cloud model (via configured endpoint)

### GLM Models (Requires Z.AI API key)
- `glm-4.7-flash` - GLM 4.7 Flash (Free tier, via Z.AI API)

### Hugging Face Models (Requires HF API token)
- `huggingface` - Use any model from Hugging Face Inference API
  - When selecting `huggingface` from the model picker, a **submenu** appears with:
    - **Recently Used**: Your last 5 HF models (stored in globalState)
    - **Popular Models**: Configurable list from `hfPopularModels` setting
    - **Custom**: Enter any HF model identifier manually
  - Default popular models:
    - `Qwen/Qwen2.5-Coder-7B-Instruct`
    - `Qwen/Qwen2.5-Coder-32B-Instruct`
    - `mistralai/Mistral-7B-Instruct-v0.3`
    - `codellama/CodeLlama-7b-Instruct-hf`
    - `bigcode/starcoder2-15b`
    - `meta-llama/Llama-3.1-8B-Instruct`
    - `deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct`

### Gemini Models (Requires Google AI Studio API key)
- `gemini-2.5-flash` - Gemini 2.5 Flash (Free tier: 250 RPD, 15 RPM)
- `gemini-2.5-pro` - Gemini 2.5 Pro (Free tier: 100 RPD, 5 RPM)
  - Both models feature 1M token context window
  - Get API key at https://aistudio.google.com/ (no credit card required)

### Mistral Models (Requires Mistral AI API key)
- `mistral-large-latest` - Mistral Large (most capable)
- `mistral-small-latest` - Mistral Small (fast & efficient)
- `codestral-latest` - Codestral (optimized for code)
  - Get API key at https://console.mistral.ai/

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
- `getLastPerformanceMetrics()` - Retrieve captured metrics from last API call
- `clearPerformanceMetrics()` - Reset metrics state
- `checkActiveModels()` - Query Ollama's `/api/ps` for active model info (VRAM usage)
- `showHfModelPicker()` - Display HF model selection submenu with recent/popular/custom options
- `getRecentHfModels()` - Get recently used HF models from globalState
- `addRecentHfModel()` - Add a model to recent HF models list

## Performance Metrics System

The extension captures and displays performance metrics from API responses in the review panel.

### PerformanceMetrics Interface (src/extension.ts:19-52)

```typescript
interface PerformanceMetrics {
  // Ollama-specific (from response body)
  totalDuration?: number;      // Total duration in nanoseconds
  loadDuration?: number;       // Model load duration in nanoseconds
  promptEvalCount?: number;    // Input tokens
  evalCount?: number;          // Output tokens
  evalDuration?: number;       // Generation duration in nanoseconds

  // Hugging Face-specific (from headers)
  hfRateLimitRemaining?: number;
  hfRateLimitReset?: number;   // Unix timestamp

  // Claude-specific
  claudeInputTokens?: number;
  claudeOutputTokens?: number;

  // Gemini-specific
  geminiInputTokens?: number;
  geminiOutputTokens?: number;

  // Mistral-specific
  mistralInputTokens?: number;
  mistralOutputTokens?: number;

  // Computed metrics
  tokensPerSecond?: number;
  totalDurationSeconds?: number;
  model?: string;
  provider?: 'ollama' | 'claude' | 'glm' | 'huggingface' | 'gemini' | 'mistral';

  // Active model info (Ollama /api/ps)
  activeModel?: {
    name: string;
    sizeVram?: number;   // VRAM usage in bytes
    sizeTotal?: number;  // Total model size
    expiresAt?: string;
  };
}
```

### Metrics Capture by Provider

| Provider | Metrics Captured |
|----------|-----------------|
| Ollama | Total duration, load time, token counts, tokens/sec, VRAM usage |
| Claude | Input/output tokens |
| GLM | Prompt/completion tokens |
| Hugging Face | Token counts, rate limit remaining, rate limit reset time |
| Gemini | Input/output tokens |
| Mistral | Input/output tokens |

### UI Display (reviewProvider.ts)

Metrics are displayed in a collapsible "System Info" panel at the bottom of the review webview:
- Model name and provider
- Total duration (formatted as ms/s/min)
- Generation speed (tokens/sec) for Ollama
- Input/output token counts
- VRAM usage with active model badge (Ollama)
- Rate limit warnings (Hugging Face)

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

## Roadmap & Future Development

See [docs/roadmap/](./docs/roadmap/) for comprehensive planning documents:

| Document | Purpose |
|----------|---------|
| [README.md](./docs/roadmap/README.md) | Roadmap overview, phases, priorities |
| [FEATURES.md](./docs/roadmap/FEATURES.md) | Detailed feature specifications (F-001 to F-012) |
| [ARCHITECTURE.md](./docs/roadmap/ARCHITECTURE.md) | Technical architecture decisions (ADRs) |

### Key Planned Features

| Phase | Features | Target |
|-------|----------|--------|
| v2.0 | Review Profiles, Smart Diff Filtering, Export Options | Q2 2025 |
| v2.5 | GitHub PR Integration, Inline Code Actions, Custom Prompts | Q3 2025 |
| v3.0 | Agentic Multi-Step Reviews, RAG-Enhanced Reviews | Q4 2025 |
| v4.0 | CI/CD Integration, Analytics, Team Knowledge Base | Q1 2026 |
