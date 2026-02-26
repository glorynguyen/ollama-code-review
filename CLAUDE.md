# Ollama Code Review - Project Knowledge Base

## Project Overview

- **Name:** Ollama Code Review VS Code Extension
- **Version:** 6.0.0
- **Purpose:** AI-powered code reviews and commit message generation using local Ollama or cloud models
- **Author:** Vinh Nguyen (vincent)
- **License:** MIT
- **Repository:** https://github.com/glorynguyen/ollama-code-review.git

## Tech Stack

- **Language:** TypeScript 5.9.2
- **Framework:** VS Code Extension API (requires VS Code 1.102.0+)
- **HTTP Client:** Axios 1.11.0
- **GitHub API:** @octokit/rest 22.0.1
- **YAML Parsing:** js-yaml 4.1.1
- **Build:** Webpack + TypeScript Compiler
- **Linting:** ESLint 9.32.0
- **Release:** semantic-release 25.0.2

## Project Structure

```
src/
├── extension.ts          # Thin entry wrapper (lazy-loads command module)
├── commands/             # Extracted command/runtime module set (F-027)
│   ├── index.ts          # Main activation logic and command registration
│   ├── providerClients.ts # Provider detection, API clients, streaming, metrics
│   ├── aiActions.ts      # Explain/tests/fix/docs/suggestion AI helpers
│   └── uiHelpers.ts      # Status bar, QuickPick, and UI utilities
├── reviewProvider.ts     # Webview panel for review results & interactive chat
├── skillsService.ts      # Agent skills download/caching from GitHub
├── skillsBrowserPanel.ts # Skills browser UI webview
├── diffFilter.ts         # Diff filtering & ignore patterns (F-002)
├── preCommitGuard.ts     # Pre-commit guard: hook management & severity assessment (F-014)
├── profiles.ts           # Review profiles & presets (F-001)
├── utils.ts              # Config helper functions
├── analytics/            # Review history & analytics (F-011)
│   ├── index.ts          # Barrel exports
│   ├── tracker.ts        # Category extraction, aggregation, CSV/JSON export
│   └── dashboard.ts      # Rich analytics dashboard webview
├── config/               # Project-level config file support (F-006)
│   └── promptLoader.ts   # .ollama-review.yaml loader, config hierarchy, caching
├── github/               # GitHub integration module (F-004)
│   ├── auth.ts           # Multi-strategy GitHub auth (gh CLI / VS Code session / token)
│   ├── prReview.ts       # PR fetching, diff retrieval, comment posting
│   └── commentMapper.ts  # AI review → structured findings & inline comment mapping
├── context/              # Multi-file contextual analysis (F-008)
│   ├── index.ts          # Barrel exports
│   ├── types.ts          # Context gathering interfaces
│   ├── importParser.ts   # ES6/CommonJS/dynamic import parser
│   ├── fileResolver.ts   # Import → workspace file resolution
│   ├── testDiscovery.ts  # Test file discovery by naming conventions
│   └── contextGatherer.ts # Main orchestrator: gather, budget, format
├── codeActions/          # Inline AI code actions (F-005)
│   ├── index.ts          # Module exports
│   ├── types.ts          # Common types and utilities
│   ├── explainAction.ts  # Explain Code action provider
│   ├── testAction.ts     # Generate Tests action provider
│   ├── fixAction.ts      # Fix Issue action provider
│   └── documentAction.ts # Add Documentation action provider
├── agent/                # Agentic multi-step reviews (F-007)
│   ├── index.ts          # Barrel exports
│   ├── types.ts          # Agent step interfaces, context types
│   ├── orchestrator.ts   # Main 5-step pipeline orchestrator
│   └── steps/            # Individual pipeline steps
│       ├── analyzeDiff.ts      # Step 1: Structural diff analysis (local)
│       ├── gatherContext.ts    # Step 2: Workspace context gathering
│       ├── patternAnalysis.ts  # Step 3: Codebase pattern detection (AI)
│       ├── deepReview.ts       # Step 4: Comprehensive review (AI)
│       └── synthesis.ts        # Step 5: Self-critique & synthesis (AI)
├── diagramGenerator.ts   # Architecture diagram generation — Mermaid.js (F-020)
├── knowledge/            # Team Knowledge Base (F-012)
│   ├── index.ts          # Barrel exports
│   ├── types.ts          # Knowledge entry interfaces
│   ├── loader.ts         # .ollama-review-knowledge.yaml loader with caching
│   └── matcher.ts        # Keyword-based knowledge matching for review context
├── gitlab/               # GitLab MR integration module (F-015)
│   ├── auth.ts           # GitLab auth (glab CLI / stored token)
│   └── mrReview.ts       # MR fetching, diff retrieval, comment posting
├── bitbucket/            # Bitbucket PR integration module (F-015)
│   ├── auth.ts           # Bitbucket auth (App Passwords)
│   └── prReview.ts       # PR fetching, diff retrieval, comment posting
├── notifications/        # Notification integrations (F-018)
│   └── index.ts          # Slack / Teams / Discord webhook delivery
├── reviewScore.ts        # Review quality scoring & history (F-016)
└── test/
    └── extension.test.ts # Mocha test suite

out/                      # Compiled JavaScript output
.github/workflows/        # CI/CD (semantic-release)
```

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/extension.ts` | ~60 | Thin wrapper that lazy-loads `src/commands` |
| `src/commands/index.ts` | ~3,000 | Main extension logic, command registration, review workflows |
| `src/commands/providerClients.ts` | ~1,100 | Provider routing, API clients, streaming support, performance metrics |
| `src/commands/aiActions.ts` | ~290 | Shared AI code-action helper functions |
| `src/commands/uiHelpers.ts` | ~380 | Shared VS Code UI helpers and pickers |
| `src/reviewProvider.ts` | ~599 | Webview for displaying reviews with chat interface + export toolbar |
| `src/skillsService.ts` | ~593 | Fetches/caches agent skills from GitHub repos |
| `src/skillsBrowserPanel.ts` | ~516 | UI for browsing and downloading skills |
| `src/diffFilter.ts` | ~245 | Diff filtering with ignore patterns and formatting detection |
| `src/profiles.ts` | ~365 | Review profiles: built-in presets, 6 compliance profiles, custom profiles, prompt context builder |
| `src/utils.ts` | ~33 | Helper for model config, HTML escaping, and prompt template resolution |
| `src/config/promptLoader.ts` | ~270 | .ollama-review.yaml loader with config hierarchy and workspace-aware caching |
| `src/context/index.ts` | ~25 | Barrel exports for the context module |
| `src/context/types.ts` | ~90 | Context gathering interfaces and types |
| `src/context/importParser.ts` | ~100 | ES6/CommonJS/dynamic import() parser |
| `src/context/fileResolver.ts` | ~115 | Import specifier → workspace file resolution |
| `src/context/testDiscovery.ts` | ~110 | Test file discovery by naming conventions |
| `src/context/contextGatherer.ts` | ~240 | Main orchestrator: gather context, enforce budget, format for prompt |
| `src/github/auth.ts` | ~112 | Multi-strategy GitHub auth: gh CLI → VS Code session → stored token |
| `src/github/prReview.ts` | ~328 | PR fetching, diff retrieval, comment posting, PR listing |
| `src/github/commentMapper.ts` | ~284 | Parse AI review into structured findings; format inline comments |
| `src/codeActions/index.ts` | ~34 | Module barrel exports for code actions |
| `src/codeActions/explainAction.ts` | ~160 | Explain Code action with preview panel |
| `src/codeActions/testAction.ts` | ~367 | Generate Tests action with framework detection |
| `src/codeActions/fixAction.ts` | ~422 | Fix Issue action with diff preview |
| `src/codeActions/documentAction.ts` | ~369 | Add Documentation action with preview |
| `src/codeActions/types.ts` | ~103 | Common types and parsing utilities |
| `src/preCommitGuard.ts` | ~185 | Pre-commit guard: hook install/uninstall, severity assessment (F-014) |
| `src/reviewScore.ts` | ~280 | Review quality scoring, score history store, status bar, history panel (F-016) |
| `src/notifications/index.ts` | ~245 | Slack / Teams / Discord webhook notifications after reviews (F-018) |
| `src/agent/index.ts` | ~15 | Barrel exports for agentic review module (F-007) |
| `src/agent/types.ts` | ~120 | Agent step interfaces, context types, pipeline result (F-007) |
| `src/agent/orchestrator.ts` | ~185 | 5-step pipeline orchestrator with cancellation & fallback (F-007) |
| `src/agent/steps/analyzeDiff.ts` | ~95 | Step 1: Structural diff analysis (local, no AI call) (F-007) |
| `src/agent/steps/gatherContext.ts` | ~90 | Step 2: Workspace context via F-008 + pattern discovery (F-007) |
| `src/agent/steps/patternAnalysis.ts` | ~80 | Step 3: AI-powered codebase convention detection (F-007) |
| `src/agent/steps/deepReview.ts` | ~90 | Step 4: Comprehensive AI code review (F-007) |
| `src/agent/steps/synthesis.ts` | ~75 | Step 5: Self-critique and findings refinement (F-007) |
| `src/diagramGenerator.ts` | ~120 | Mermaid.js diagram generation from code/diffs (F-020) |
| `src/knowledge/index.ts` | ~25 | Barrel exports for knowledge base module (F-012) |
| `src/knowledge/types.ts` | ~85 | Knowledge entry interfaces, config types (F-012) |
| `src/knowledge/loader.ts` | ~215 | .ollama-review-knowledge.yaml loader with caching and validation (F-012) |
| `src/knowledge/matcher.ts` | ~150 | Keyword-based knowledge matching for review context (F-012) |
| `src/gitlab/auth.ts` | ~97 | GitLab auth: glab CLI → stored token (F-015) |
| `src/gitlab/mrReview.ts` | ~330 | MR fetching, diff retrieval, comment posting, MR listing (F-015) |
| `src/bitbucket/auth.ts` | ~72 | Bitbucket auth via App Passwords (F-015) |
| `src/bitbucket/prReview.ts` | ~290 | PR fetching, diff retrieval, comment posting, PR listing (F-015) |
| `src/analytics/index.ts` | ~15 | Barrel exports for analytics module (F-011) |
| `src/analytics/tracker.ts` | ~250 | Category extraction, aggregation, weekly trends, CSV/JSON export (F-011) |
| `src/analytics/dashboard.ts` | ~320 | Rich analytics dashboard webview with Chart.js (F-011) |
| `src/rag/index.ts` | ~20 | Barrel exports for RAG module (F-009) |
| `src/rag/types.ts` | ~80 | RagConfig, CodeChunk, VectorStore, RetrievalResult interfaces (F-009) |
| `src/rag/config.ts` | ~20 | `getRagConfig()` VS Code settings reader (F-009) |
| `src/rag/embeddings.ts` | ~90 | Ollama embedding generation, TF-IDF fallback, cosine similarity (F-009) |
| `src/rag/vectorStore.ts` | ~110 | `JsonVectorStore` — JSON-based persistence, no native deps (F-009) |
| `src/rag/indexer.ts` | ~120 | `indexWorkspace()`, `indexFile()`, `chunkText()` (F-009) |
| `src/rag/retriever.ts` | ~90 | `getRagContext()`, `buildRagContextSection()`, similarity search (F-009) |
| `packages/cli/src/index.ts` | ~160 | CLI entry point, Commander.js argument parsing (F-010) |
| `packages/cli/src/config.ts` | ~100 | Config builder from args + env vars, profile prompts (F-010) |
| `packages/cli/src/review.ts` | ~180 | `buildPrompt()`, `callAIProvider()` for all 7 providers (F-010) |
| `packages/cli/src/output.ts` | ~90 | Severity parsing, failure logic, output formatters (F-010) |
| `packages/cli/src/github.ts` | ~80 | GitHub PR comment posting, env-based PR context (F-010) |
| `ci-templates/github-actions.yml` | — | Production-ready GitHub Actions workflow template (F-010) |
| `ci-templates/gitlab-ci.yml` | — | GitLab CI YAML template (F-010) |

## Commands

| Command ID | Description |
|------------|-------------|
| `ollama-code-review.selectModel` | Pick AI model (cloud/local Ollama) |
| `ollama-code-review.selectProfile` | Pick review profile (general/security/performance/etc.) |
| `ollama-code-review.reviewChanges` | Review staged Git changes |
| `ollama-code-review.reviewCommit` | Review a specific commit |
| `ollama-code-review.reviewCommitRange` | Review a range of commits |
| `ollama-code-review.reviewChangesBetweenTwoBranches` | Compare two branches |
| `ollama-code-review.generateCommitMessage` | Auto-generate conventional commit message |
| `ollama-code-review.suggestRefactoring` | Code suggestions via lightbulb/context menu |
| `ollama-code-review.explainCode` | Explain selected code in preview panel |
| `ollama-code-review.generateTests` | Generate unit tests for selected code |
| `ollama-code-review.fixIssue` | Fix diagnostics or selected code with diff preview |
| `ollama-code-review.fixSelection` | Fix selected code |
| `ollama-code-review.addDocumentation` | Generate JSDoc/TSDoc for functions/classes |
| `ollama-code-review.browseAgentSkills` | Browse and download agent skills |
| `ollama-code-review.applySkillToReview` | Apply multiple skills to reviews (multi-select supported) |
| `ollama-code-review.clearSelectedSkills` | Clear all selected skills |
| `ollama-code-review.reviewGitHubPR` | Review a GitHub Pull Request by URL or number |
| `ollama-code-review.postReviewToPR` | Post AI review as a comment to a GitHub PR |
| `ollama-code-review.reloadProjectConfig` | Reload/reset the .ollama-review.yaml config file cache |
| `ollama-code-review.togglePreCommitGuard` | Enable/disable the pre-commit guard git hook |
| `ollama-code-review.reviewAndCommit` | Review staged changes with AI, then commit if findings pass threshold |
| `ollama-code-review.reviewFile` | Review the currently open file without requiring a Git diff (F-019) |
| `ollama-code-review.reviewFolder` | Review all matching files in a folder without requiring a Git diff (F-019) |
| `ollama-code-review.reviewSelection` | Review selected text in the editor without requiring a Git diff (F-019) |
| `ollama-code-review.showReviewHistory` | Open the Review Quality History panel with score trends (F-016) |
| `ollama-code-review.agentReview` | Run the 5-step agentic multi-step review pipeline on staged changes (F-007) |
| `ollama-code-review.generateDiagram` | Generate a Mermaid architecture diagram from the current review or staged diff (F-020) |
| `ollama-code-review.showAnalyticsDashboard` | Open the Review Analytics Dashboard with comprehensive metrics, charts, and export (F-011) |
| `ollama-code-review.reloadKnowledgeBase` | Reload the Team Knowledge Base (.ollama-review-knowledge.yaml) cache (F-012) |
| `ollama-code-review.reviewGitLabMR` | Review a GitLab Merge Request by URL or number (F-015) |
| `ollama-code-review.postReviewToMR` | Post AI review as a comment to a GitLab MR (F-015) |
| `ollama-code-review.reviewBitbucketPR` | Review a Bitbucket Pull Request by URL or number (F-015) |
| `ollama-code-review.postReviewToBitbucketPR` | Post AI review as a comment to a Bitbucket PR (F-015) |
| `ollama-code-review.indexCodebase` | Index workspace files into the RAG vector store for semantic retrieval (F-009) |
| `ollama-code-review.clearRagIndex` | Clear the RAG codebase index from global storage (F-009) |

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
| `ollama-code-review.minimaxApiKey` | `""` | MiniMax API key for MiniMax models |
| `ollama-code-review.openaiCompatible.endpoint` | `http://localhost:1234/v1` | Base URL for OpenAI-compatible server (LM Studio, vLLM, LocalAI, Groq, OpenRouter, etc.) |
| `ollama-code-review.openaiCompatible.apiKey` | `""` | API key for OpenAI-compatible endpoint (leave empty for local servers) |
| `ollama-code-review.openaiCompatible.model` | `""` | Model name to request from the OpenAI-compatible endpoint |
| `ollama-code-review.endpoint` | `http://localhost:11434/api/generate` | Ollama API endpoint |
| `ollama-code-review.temperature` | `0` | Model temperature (0-1) |
| `ollama-code-review.frameworks` | `["React"]` | Target frameworks for context |
| `ollama-code-review.diffFilter` | `{}` | Diff filtering configuration (see Diff Filtering section) |
| `ollama-code-review.contextGathering` | `{}` | Multi-file context gathering configuration (see Context Gathering section) |
| `ollama-code-review.preCommitGuard.severityThreshold` | `"high"` | Block commits when findings at or above this severity (critical/high/medium/low) |
| `ollama-code-review.preCommitGuard.timeout` | `60` | AI review timeout in seconds for Review & Commit (10–300) |
| `ollama-code-review.customProfiles` | `[]` | Custom review profiles (array of objects with name, focusAreas, severity, etc.) |
| `ollama-code-review.prompt.review` | (built-in review prompt) | Custom prompt template for code reviews. Variables: `${code}`, `${frameworks}`, `${skills}`, `${profile}` |
| `ollama-code-review.prompt.commitMessage` | (built-in commit prompt) | Custom prompt template for commit messages. Variables: `${diff}`, `${draftMessage}` |
| `ollama-code-review.github.token` | `""` | GitHub Personal Access Token (repo scope) for PR reviews and posting comments |
| `ollama-code-review.github.commentStyle` | `"summary"` | How to post reviews to GitHub PRs: `summary`, `inline`, or `both` |
| `ollama-code-review.github.gistToken` | `""` | GitHub Personal Access Token (gist scope) for creating Gists from reviews |
| `ollama-code-review.skills.defaultRepository` | `vercel-labs/agent-skills` | Default GitHub repo for skills |
| `ollama-code-review.skills.additionalRepositories` | `[]` | Additional GitHub repos for skills |
| `ollama-code-review.skills.autoApply` | `true` | Auto-apply selected skill |
| `ollama-code-review.notifications.slack.webhookUrl` | `""` | Slack incoming webhook URL for review notifications (F-018) |
| `ollama-code-review.notifications.teams.webhookUrl` | `""` | Microsoft Teams incoming webhook URL for review notifications (F-018) |
| `ollama-code-review.notifications.discord.webhookUrl` | `""` | Discord webhook URL for review notifications (F-018) |
| `ollama-code-review.notifications.triggerOn` | `["critical","high"]` | Severity levels that trigger a notification (F-018) |
| `ollama-code-review.batch.maxFileSizeKb` | `100` | Max file size (KB) for batch file reviews; larger files are truncated (F-019) |
| `ollama-code-review.batch.includeGlob` | `**/*.{ts,js,...}` | Glob pattern for files included in folder reviews (F-019) |
| `ollama-code-review.batch.excludeGlob` | `**/node_modules/**,...` | Comma-separated glob patterns for files excluded from folder reviews (F-019) |
| `ollama-code-review.agentMode` | `{}` | Agentic multi-step review configuration (F-007) |
| `ollama-code-review.knowledgeBase` | `{}` | Team Knowledge Base configuration (F-012) |
| `ollama-code-review.gitlab.token` | `""` | GitLab Personal Access Token (api scope) for MR reviews and posting comments (F-015) |
| `ollama-code-review.gitlab.baseUrl` | `"https://gitlab.com"` | Base URL for self-hosted GitLab instances (F-015) |
| `ollama-code-review.bitbucket.username` | `""` | Bitbucket username for API authentication (F-015) |
| `ollama-code-review.bitbucket.appPassword` | `""` | Bitbucket App Password (Pullrequests Read/Write scope) (F-015) |
| `ollama-code-review.rag` | `{}` | RAG-Enhanced Reviews configuration (F-009) |

### RAG Settings (F-009)

The `rag` setting is an object with these properties:

| Property | Default | Description |
|----------|---------|-------------|
| `enabled` | `false` | Enable RAG context injection during reviews |
| `indexOnStartup` | `false` | Re-index workspace on extension startup (background) |
| `embeddingModel` | `"nomic-embed-text"` | Ollama embedding model; TF-IDF used as fallback |
| `maxResults` | `5` | Max similar code snippets to inject per review (1–20) |
| `similarityThreshold` | `0.65` | Minimum cosine similarity score for inclusion (0–1) |
| `includeGlob` | `**/*.{ts,js,...}` | Glob pattern for files to index |
| `excludeGlob` | `**/node_modules/**,...` | Comma-separated patterns to exclude from indexing |
| `chunkSize` | `1500` | Max characters per code chunk (200–8000) |
| `chunkOverlap` | `150` | Character overlap between chunks (0–1000) |

### Diff Filter Settings

The `diffFilter` setting is an object with these properties:

| Property | Default | Description |
|----------|---------|-------------|
| `ignorePaths` | `["**/node_modules/**", "**/*.lock", ...]` | Glob patterns for paths to ignore |
| `ignorePatterns` | `["*.min.js", "*.min.css", "*.map", "*.generated.*"]` | File name patterns to ignore |
| `maxFileLines` | `500` | Warn when a file has more changed lines than this |
| `ignoreFormattingOnly` | `false` | Skip files with only whitespace/formatting changes |

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

### MiniMax Models (Requires MiniMax API key)
- `MiniMax-M2.5` - MiniMax M2.5
  - Get API key at https://platform.minimaxi.com/

### Claude Models (Requires Anthropic API key)
- `claude-sonnet-4-20250514` - Claude Sonnet 4
- `claude-opus-4-20250514` - Claude Opus 4
- `claude-3-7-sonnet-20250219` - Claude 3.7 Sonnet

### OpenAI-Compatible Servers (F-013)
- `openai-compatible` — Generic provider for any server exposing `/v1/chat/completions`
  - When selected from the model picker, a **server picker** appears with presets:
    - **LM Studio** (`http://localhost:1234/v1`) — default local server
    - **LocalAI** (`http://localhost:8080/v1`)
    - **vLLM** (`http://localhost:8000/v1`)
    - **Groq**, **OpenRouter**, **Together AI** — cloud aggregators
    - **Custom** — enter any base URL manually
  - Model name is entered via input box after selecting the server
  - API key is optional (omitted for local servers without auth)
  - Configuration stored in `openaiCompatible.endpoint`, `openaiCompatible.apiKey`, `openaiCompatible.model`

### Local Ollama Models
Any model available in your local Ollama instance will be auto-discovered. The predefined local model in settings is `qwen2.5-coder:14b-instruct-q4_0`.

## Architecture

### Extension Activation
1. Activates on: JS/TS/JSX/TSX/PHP files or SCM view
2. Entry: `activate()` in `src/extension.ts` (thin wrapper)
3. Command registration and status bar setup happen in `src/commands/index.ts`

### API Endpoints Used

#### Ollama (Local)
- **Generate:** `{endpoint}/api/generate` - Reviews, commit messages, suggestions
- **Chat:** `{endpoint}/api/chat` - Interactive follow-up questions
- **Tags:** `{endpoint}/api/tags` - List available local models
- **PS:** `{endpoint}/api/ps` - Active model info (VRAM usage)

#### Cloud Providers
- **Claude:** `https://api.anthropic.com/v1/messages`
- **GLM:** `https://api.z.ai/api/paas/v4/chat/completions`
- **Hugging Face:** `https://router.huggingface.co/v1/chat/completions`
- **Gemini:** `https://generativelanguage.googleapis.com/v1beta/models`
- **Mistral:** `https://api.mistral.ai/v1/chat/completions`
- **MiniMax:** `https://api.minimax.io/v1/text/chatcompletion_v2`
- **OpenAI-Compatible:** `{openaiCompatible.endpoint}/chat/completions` (user-configured)

### Git Integration
- Uses VS Code's built-in Git extension API
- Supports: staged changes, commit diffs, branch comparisons
- Multi-repository workspace support
- Diff filtering to exclude noise (lock files, build output, minified files)

### Webview Panels
- **Review Panel:** Displays markdown reviews with highlight.js, supports multi-turn chat
- **Skills Browser:** Lists/downloads skills with search filtering and repo source display
- **Explain Panel:** Shows code explanations with syntax highlighting
- **Test Preview Panel:** Displays generated tests before creating files
- **Fix Preview Panel:** Shows proposed fixes in diff view
- **Documentation Panel:** Previews JSDoc/TSDoc before insertion

## Key Functions in Commands Modules

### Model Detection
Located in `src/commands/providerClients.ts`:
- `isClaudeModel()` - Check if model is a Claude model
- `isGlmModel()` - Check if model is a GLM model
- `isHuggingFaceModel()` - Check if model is Hugging Face
- `isGeminiModel()` - Check if model is Gemini
- `isMistralModel()` - Check if model is Mistral
- `isMiniMaxModel()` - Check if model is MiniMax
- `isOpenAICompatibleModel()` - Check if model is OpenAI-compatible (returns `model === 'openai-compatible'`)

### API Callers
Located in `src/commands/providerClients.ts`:
- `callClaudeAPI()` - Call Anthropic Claude API
- `callGlmAPI()` - Call Z.AI GLM API
- `callHuggingFaceAPI()` - Call Hugging Face Inference API
- `callGeminiAPI()` - Call Google Gemini API
- `callMistralAPI()` - Call Mistral AI API
- `callMiniMaxAPI()` - Call MiniMax API
- `callOpenAICompatibleAPI()` - Call any OpenAI-compatible endpoint (`/v1/chat/completions`)
- `showOpenAICompatiblePicker()` - Show server preset picker + model name input for initial configuration

### Core Workflow
- `activate()` (`src/commands/index.ts`) - command registration, status bars, file watchers
- `runReview()` (`src/commands/index.ts`) - execute review workflow
- `getOllamaReview()` (`src/commands/index.ts`) - call selected provider for review
- `getOllamaCommitMessage()` (`src/commands/index.ts`) - generate commit message
- `getOllamaSuggestion()` (`src/commands/aiActions.ts`) - get code suggestions
- `selectRepository()` (`src/commands/uiHelpers.ts`) - handle multi-repo workspaces
- `runGitCommand()` (`src/commands/uiHelpers.ts`) - execute git operations
- `reloadProjectConfig` command handler - Calls `clearProjectConfigCache()` and notifies user

### Code Action Handlers
Located in `src/commands/aiActions.ts`:
- `getExplanation()` - Get AI explanation for selected code
- `generateTests()` - Generate unit tests for selected code
- `generateFix()` - Generate fix for diagnostics or selected code
- `generateDocumentation()` - Generate JSDoc/TSDoc for functions/classes

### Performance & Model Management
Located in `src/commands/providerClients.ts` unless noted:
- `getLastPerformanceMetrics()` - Retrieve captured metrics from last API call
- `clearPerformanceMetrics()` - Reset metrics state
- `checkActiveModels()` - Query Ollama's `/api/ps` for active model info (VRAM usage)
- `showHfModelPicker()` - Display HF model selection submenu with recent/popular/custom options (`src/commands/uiHelpers.ts`)
- `addRecentHfModel()` - Add a model to recent HF models list (`src/commands/uiHelpers.ts`)
- `updateModelStatusBar()` - Update status bar with current model name (`src/commands/uiHelpers.ts`)

### Error Handling
- `handleError()` - Centralized error handler with user-friendly messages

### Internal Classes
- `OllamaSuggestionProvider` - CodeActionProvider for suggestions
- `SuggestionContentProvider` - TextDocumentContentProvider for suggestion previews

## Key Functions in utils.ts

- `getOllamaModel()` - Resolve model name from config, handling 'custom' option
- `escapeHtml()` - XSS prevention for webview content rendering
- `resolvePrompt(template, variables)` - Replace `${variable}` placeholders in prompt templates

## Diff Filtering System (F-002)

The `src/diffFilter.ts` module provides intelligent diff filtering to exclude noise from code reviews.

### Exported Types

```typescript
interface DiffFilterConfig {
  ignorePaths: string[];
  ignorePatterns: string[];
  maxFileLines: number;
  ignoreFormattingOnly: boolean;
}

interface FilterResult {
  filteredDiff: string;
  stats: {
    totalFiles: number;
    includedFiles: number;
    filteredFiles: string[];
    largeFiles: string[];
  };
}
```

### Exported Functions

- `getDiffFilterConfig()` - Read filter config from VS Code settings with defaults
- `getDiffFilterConfigWithYaml()` - Async version; merges defaults → VS Code settings → `.ollama-review.yaml` overrides
- `filterDiff(diff, config?)` - Main filtering function, returns filtered diff and stats
- `getFilterSummary(result)` - Generate human-readable summary of what was filtered

### Default Ignore Paths
`**/node_modules/**`, `**/*.lock`, `**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/dist/**`, `**/build/**`, `**/out/**`, `**/.next/**`, `**/coverage/**`

### Default Ignore Patterns
`*.min.js`, `*.min.css`, `*.map`, `*.generated.*`, `*.g.ts`, `*.d.ts.map`

### Internal Helpers
- `shouldIgnoreFile()` - Checks path and pattern matching
- `matchGlobPattern()` - Simple glob-to-regex conversion
- `countChangedLines()` - Counts +/- lines in a diff hunk
- `isFormattingOnlyChange()` - Detects whitespace-only changes
- `parseDiffIntoFiles()` - Splits unified diff by file

## Multi-File Context Gathering (F-008)

The `src/context/` module provides multi-file contextual analysis that resolves imports, discovers related tests, and bundles workspace file contents alongside diffs so the AI reviewer has richer context.

### How It Works

1. When a review starts, the extension extracts changed file paths from the diff
2. For each changed file, it reads the source and parses import/require statements
3. Relative imports are resolved to actual workspace files using TypeScript-style resolution
4. Related test files are discovered by naming convention (`.test.ts`, `.spec.ts`, `__tests__/`)
5. Type-definition files (`.d.ts`) are discovered for changed TypeScript modules
6. All resolved files are read (with per-file and total character budgets) and formatted into the review prompt

### Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `enabled` | `true` | Include related files as context in reviews |
| `maxFiles` | `10` | Maximum number of context files to include |
| `includeTests` | `true` | Include test files for changed source files |
| `includeTypeDefinitions` | `true` | Include `.d.ts` type definitions for changed modules |

### Exported Types (src/context/types.ts)

```typescript
interface ContextGatheringConfig {
  enabled: boolean;
  maxFiles: number;
  includeTests: boolean;
  includeTypeDefinitions: boolean;
}

type ContextFileReason = 'import' | 'test' | 'type-definition';

interface ContextFile {
  relativePath: string;
  content: string;
  reason: ContextFileReason;
  sourceFile: string;
  charCount: number;
}

interface ContextBundle {
  files: ContextFile[];
  summary: string;
  stats: ContextGatheringStats;
}
```

### Exported Functions

| Function | File | Description |
|----------|------|-------------|
| `gatherContext(diff, config, outputChannel?)` | `contextGatherer.ts` | Main orchestrator — returns a `ContextBundle` |
| `formatContextForPrompt(bundle)` | `contextGatherer.ts` | Format bundle into prompt-ready string |
| `getContextGatheringConfig()` | `contextGatherer.ts` | Read settings from VS Code configuration |
| `parseImports(content)` | `importParser.ts` | Extract import/require statements from source |
| `extractChangedFiles(diff)` | `importParser.ts` | Extract changed file paths from unified diff |
| `resolveImport(specifier, sourceFile, workspaceRoot)` | `fileResolver.ts` | Resolve relative import to workspace file URI |
| `readFileContent(uri, maxChars?)` | `fileResolver.ts` | Read file with optional character limit |
| `findTestFiles(sourceFile, workspaceRoot)` | `testDiscovery.ts` | Discover test files by naming conventions |

### Import Patterns Supported

- ES6 static: `import foo from './module'`, `import { foo } from './module'`, `import * as foo from './module'`
- ES6 side-effect: `import './module'`
- ES6 re-export: `export { foo } from './module'`, `export * from './module'`
- CommonJS: `const foo = require('./module')`, `require('./module')`
- Dynamic: `import('./module')`, `await import('./module')`

### File Resolution Order

For `import './foo'`:
1. `./foo` (exact match)
2. `./foo.ts`, `./foo.tsx`, `./foo.js`, `./foo.jsx`, `./foo.mts`, `./foo.mjs` (appended extensions)
3. `./foo/index.ts`, `./foo/index.tsx`, `./foo/index.js`, … (directory index files)

### Test Discovery Patterns

For `src/auth.ts`:
- Co-located: `src/auth.test.ts`, `src/auth.spec.ts`
- Mirror dirs: `src/__tests__/auth.ts`, `src/test/auth.ts`, `src/tests/auth.ts`
- Root-level: `__tests__/auth.ts`, `test/auth.test.ts`, `tests/auth.spec.ts`

### Token Budget

- Per-file limit: 8,000 characters (≈ 2,000 tokens)
- Total budget: 32,000 characters (≈ 8,000 tokens)
- Files exceeding the budget are truncated with a `// … truncated` marker

### Integration

Context is gathered automatically during `runReview()` and the Review & Commit workflow. The gathered context is appended to the review prompt as a **Related Files** section after the diff. If context gathering fails, the review proceeds without context (non-fatal).

## Project Config File System (F-006)

The `src/config/promptLoader.ts` module implements a three-tier configuration hierarchy using an optional `.ollama-review.yaml` file at the workspace root.

### Config Hierarchy (lowest → highest priority)

1. Built-in defaults (hardcoded in extension)
2. VS Code settings (`settings.json`)
3. `.ollama-review.yaml` at workspace root (highest priority; checked in to the repo)

### Exported Functions

- `loadProjectConfig()` - Read and parse `.ollama-review.yaml` from workspace root; workspace-aware caching
- `clearProjectConfigCache()` - Invalidate the cached config (called by file watcher and `reloadProjectConfig` command)
- `getEffectiveReviewPrompt()` - Resolve final review prompt via hierarchy
- `getEffectiveCommitPrompt()` - Resolve final commit message prompt via hierarchy
- `getEffectiveFrameworks()` - Resolve final frameworks list via hierarchy
- `getYamlDiffFilterOverrides()` - Return diff filter overrides from YAML config to merge with settings

### .ollama-review.yaml Schema

```yaml
# Prompt templates (optional — override VS Code settings and built-in defaults)
prompt:
  review: |
    Your custom review prompt here...
    Use ${code}, ${frameworks}, ${skills}, ${profile} as placeholders.
  commitMessage: |
    Your custom commit message prompt here...
    Use ${diff} and ${draftMessage} as placeholders.

# Frameworks list (optional — overrides ollama-code-review.frameworks setting)
frameworks:
  - React
  - Node.js

# Diff filter overrides (optional — merged with VS Code settings)
diffFilter:
  ignorePaths:
    - "**/generated/**"
  ignorePatterns:
    - "*.auto.ts"
  maxFileLines: 300
  ignoreFormattingOnly: true
```

### File Watcher

`extension.ts` automatically watches `**/.ollama-review.yaml` for create, change, and delete events. When any event fires, `clearProjectConfigCache()` is called so the next review picks up the updated config without requiring a manual reload.

The `reloadProjectConfig` command (`$(refresh)`) allows manual cache invalidation from the command palette.

## Pre-Commit Guard (F-014)

The `src/preCommitGuard.ts` module provides a pre-commit review workflow that runs an AI review on staged changes before committing.

### How It Works

1. **Enable the guard** via the "Toggle Pre-Commit Guard" command or the status bar shield icon
2. A git pre-commit hook is installed in `.git/hooks/pre-commit` that blocks direct commits
3. Use the **"Review & Commit"** command to:
   - Get staged diff
   - Run AI review through the existing review pipeline
   - Parse findings using `commentMapper.ts` severity detection
   - Compare findings against the configured severity threshold
   - If findings pass: offer to commit immediately or view the review
   - If findings block: show findings and offer "Commit Anyway", "View Review", or "Cancel"
4. The hook uses a temporary bypass file (`.git/.ollama-review-bypass`) to allow commits after review

### Commands

| Command | Description |
|---------|-------------|
| `togglePreCommitGuard` | Install/uninstall the pre-commit hook for the current repository |
| `reviewAndCommit` | Run AI review on staged changes, then commit if findings pass threshold |

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `preCommitGuard.severityThreshold` | `"high"` | Block on findings at or above this level: `critical`, `high`, `medium`, `low` |
| `preCommitGuard.timeout` | `60` | Review timeout in seconds (10–300) |

### Exported Functions (src/preCommitGuard.ts)

- `getPreCommitGuardConfig()` — Read guard settings from VS Code configuration
- `isHookInstalled(repoPath)` — Check if the Ollama pre-commit hook is installed
- `installHook(repoPath)` — Write the pre-commit hook script (refuses to overwrite non-Ollama hooks)
- `uninstallHook(repoPath)` — Remove the hook (only if it was installed by Ollama)
- `createBypassFile(repoPath)` — Create a temporary bypass marker for the next commit
- `removeBypassFile(repoPath)` — Clean up the bypass marker
- `assessSeverity(reviewText, diff, threshold)` — Parse review into findings and check against threshold
- `formatAssessmentSummary(assessment)` — Format findings into a human-readable summary

### Status Bar

A shield icon in the status bar shows `Guard ON` / `Guard OFF` and toggles the hook on click.

### Safety

- The hook will **not** overwrite an existing non-Ollama pre-commit hook
- Uninstall only removes hooks that contain the Ollama marker comment
- Users can always bypass the hook with `git commit --no-verify`
- The bypass file is cleaned up in a `finally` block after each commit attempt

## Inline Code Actions (F-005)

The extension provides four AI-powered code actions accessible via the lightbulb menu or `Ctrl+.`:

### Code Action Providers

| Provider | File | Purpose |
|----------|------|---------|
| `ExplainCodeActionProvider` | `explainAction.ts` | Provides "Explain Code" action |
| `GenerateTestsActionProvider` | `testAction.ts` | Provides "Generate Tests" action |
| `FixIssueActionProvider` | `fixAction.ts` | Provides "Fix Issue" action (diagnostics + selection) |
| `AddDocumentationActionProvider` | `documentAction.ts` | Provides "Add Documentation" action |

### Preview Panels

Each action has a dedicated webview panel for previewing results:
- `ExplainCodePanel` - Displays code explanations with syntax highlighting
- `GenerateTestsPanel` - Shows generated tests with "Create Test File" and "Copy to Clipboard" buttons
- `FixPreviewPanel` - Shows diff view with "Apply Fix" button; includes fix tracking
- `DocumentationPreviewPanel` - Previews JSDoc with "Insert Documentation" and "Copy" buttons

### Key Types (src/codeActions/types.ts)

```typescript
interface CodeActionResult {
  code: string;
  explanation: string;
}

interface TestGenerationResult {
  testCode: string;
  testFileName: string;
  explanation: string;
}

interface DocumentationResult {
  documentation: string;
  explanation: string;
}
```

### Fix Tracking (src/codeActions/fixAction.ts)

```typescript
interface AppliedFix {
  timestamp: Date;
  fileName: string;
  lineNumber: number;
  originalCode: string;
  fixedCode: string;
  issue: string;
}

class FixTracker {
  static getInstance(): FixTracker;
  recordFix(fix: AppliedFix): void;
  getRecentFixes(count?: number): AppliedFix[];
  clearFixes(): void;
  getFixCount(): number;
}
```

### Utility Functions

- `parseCodeResponse()` - Parse AI response with code block and explanation
- `parseTestResponse()` - Parse test generation response
- `extractSymbolName()` - Extract function/class name from code
- `createVirtualUri()` - Create virtual document URI for diff view
- `detectTestFramework()` - Detect test framework from project config
- `getTestFileName()` - Generate test file name from source file
- `getDocumentationStyle()` - Determine JSDoc vs TSDoc based on file type

## Performance Metrics System

The extension captures and displays performance metrics from API responses in the review panel.

### PerformanceMetrics Interface (src/commands/providerClients.ts)

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

  // MiniMax-specific
  minimaxInputTokens?: number;
  minimaxOutputTokens?: number;

  // OpenAI-compatible provider-specific
  openaiCompatibleInputTokens?: number;
  openaiCompatibleOutputTokens?: number;

  // Computed metrics
  tokensPerSecond?: number;
  totalDurationSeconds?: number;
  model?: string;
  provider?: 'ollama' | 'claude' | 'glm' | 'huggingface' | 'gemini' | 'mistral' | 'minimax' | 'openai-compatible';

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
| MiniMax | Input/output tokens |
| OpenAI-Compatible | Input/output tokens (from `usage.prompt_tokens` / `usage.completion_tokens`) |

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

- Skills fetched from GitHub repositories (supports multiple repos)
  - Default repository: `vercel-labs/agent-skills`
  - Additional repositories can be configured via `skills.additionalRepositories` setting
  - Skills from all configured repositories are combined in the browser
- Cached locally in extension global storage
  - Index file: `{globalStorage}/agent-skills/index.json`
  - Skill files: `{globalStorage}/agent-skills/{owner}__{repo}/{skillname}/SKILL.md`
  - Legacy migration from: `{globalStorage}/agent-skills/{skillname}/SKILL.md`
- YAML frontmatter parsed for metadata
- Dynamic ESM import for @octokit/rest (ESM-only module)
- **Multi-skill selection supported**: Users can select multiple skills to apply simultaneously
  - Skills are combined in the prompt with numbered headers (Skill 1, Skill 2, etc.)
  - Previously selected skills are pre-checked in the QuickPick dialog
  - Use `clearSelectedSkills` command to deselect all skills
- Skills browser shows repository source for each skill and supports filtering by repo
- Error handling for network errors, rate limiting (403/429), and timeouts

### Multi-Skill Storage

Selected skills are stored in VS Code's globalState as an array:
```typescript
// Storage key: 'selectedSkills' (array of AgentSkill objects)
context.globalState.get<AgentSkill[]>('selectedSkills', []);
```

### AgentSkill Interface (src/skillsService.ts)

```typescript
interface AgentSkill {
  name: string;
  description: string;
  content: string;
  repository: string;
  path: string;
  downloadedAt?: number;
}
```

### Skill Injection in Prompts

When multiple skills are selected, they are combined into the review prompt:
```
Additional Review Guidelines (N skill(s) applied):
### Skill 1: skill-name
[skill content]

### Skill 2: another-skill
[skill content]
```

## Review Panel Chat (reviewProvider.ts)

The review panel supports multi-turn interactive chat:
- Conversation history tracked as `Array<{ role: 'user' | 'assistant' | 'system', content: string }>`
- System message injected with original diff context
- Multi-skill guidelines included in follow-up prompts
- Supports Claude, MiniMax, and Ollama providers for chat follow-ups
- CDN dependencies: highlight.js v11.9.0, marked.js v11.1.1

## Export Options (F-003)

The review panel toolbar exposes four export actions via `_handleExport()` in `reviewProvider.ts`:

| Format | Action | Description |
|--------|--------|-------------|
| `clipboard` | Copy to Clipboard | Copies raw review Markdown instantly |
| `markdown` | Save as Markdown | Opens system save dialog, writes `.md` file via `vscode.workspace.fs` |
| `prDescription` | PR Description | Wraps review with header & model attribution, copies to clipboard |
| `gist` | Create GitHub Gist | Posts a private Gist via `@octokit/rest`; requires `github.gistToken` PAT |

### Private Methods (reviewProvider.ts)

- `_handleExport(format)` - Dispatcher for export formats
- `_saveAsMarkdown(content)` - Shows save dialog and writes `.md` file
- `_formatAsPrDescription(content)` - Wraps review with model attribution header
- `_createGist(content)` - Creates a private GitHub Gist; prompts to open or copy URL

### Gist Token Flow

If `ollama-code-review.github.gistToken` is empty when the user clicks "Create Gist", an error message with an "Open Settings" button is shown to guide the user to configure their PAT.

## Batch / Legacy Code Review (F-019)

The extension can review arbitrary files, folders, or selected text without requiring a Git diff. Aimed at legacy codebases, third-party code, or files not tracked by Git.

### New Commands

| Command | Entry Point | Description |
|---------|-------------|-------------|
| `ollama-code-review.reviewFile` | Explorer context menu / command palette | Review the active or selected file in full |
| `ollama-code-review.reviewFolder` | Explorer context menu / command palette | Review all matching files in a selected folder |
| `ollama-code-review.reviewSelection` | Editor context menu / command palette | Review only the selected text |

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `batch.maxFileSizeKb` | `100` | Files larger than this (KB) are truncated before review |
| `batch.includeGlob` | `**/*.{ts,js,...}` | File types included in folder reviews |
| `batch.excludeGlob` | `**/node_modules/**,...` | Paths excluded from folder reviews |

### Implementation

- `reviewFile` reads the file via `vscode.workspace.fs.readFile`, truncates to `maxFileSizeKb`, and passes content to `runFileReview()`.
- `reviewFolder` uses `vscode.workspace.findFiles()` with the configured globs, concatenates files with `--- filename ---` separators up to a token budget, and calls `runFileReview()`.
- `reviewSelection` reads `editor.document.getText(editor.selection)` and calls `runFileReview()`.
- `runFileReview()` in `src/commands/index.ts` bypasses diff filtering and uses `getOllamaFileReview()` with a file-review–flavoured prompt that doesn't reference git diff format.
- Score (F-016) and notifications (F-018) integrate automatically.

## Notification Integrations (F-018)

Post review summaries to Slack, Microsoft Teams, or Discord via incoming webhooks. Notifications are sent after every review if a webhook URL is configured and the finding severity meets the trigger threshold.

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `notifications.slack.webhookUrl` | `""` | Slack incoming webhook URL |
| `notifications.teams.webhookUrl` | `""` | Microsoft Teams incoming webhook URL |
| `notifications.discord.webhookUrl` | `""` | Discord webhook URL |
| `notifications.triggerOn` | `["critical","high"]` | Severity levels that trigger a notification; empty = always |

### Implementation (`src/notifications/index.ts`)

- `getNotificationConfig()` — read webhook URLs and trigger filter from VS Code settings
- `sendNotifications(payload, outputChannel?)` — fire-and-forget dispatch to all configured platforms
- Each platform has a dedicated payload builder: `buildSlackPayload()`, `buildTeamsPayload()`, `buildDiscordPayload()`
- Uses existing Axios dependency; no new packages required
- Notification failures are logged to the output channel but never interrupt the review flow

### Payload Formats

| Platform | Format |
|----------|--------|
| Slack | Block Kit with header, source/model/profile fields, and findings summary |
| Teams | MessageCard v1 (Adaptive Card) with facts table |
| Discord | Embed with colored border (green ≥ 80, orange ≥ 60, red < 60) |

## Review Quality Scoring & Trends (F-016)

Each review produces a 0–100 quality score derived from finding severity counts. Scores are persisted in a local JSON file and surfaced in a status bar item and a history panel.

### Scoring Algorithm

```
score = 100 − (critical × 20) − (high × 10) − (medium × 5) − (low × 2)
score = clamp(score, 0, 100)
```

Sub-scores (correctness, security, maintainability, performance) are approximated from the same deduction using fixed weights.

### Storage

- `ReviewScoreStore` in `src/reviewScore.ts` persists up to 200 entries in `{globalStorage}/review-scores.json`
- Survives VS Code restarts; no native (SQLite) dependency
- `id`, `timestamp`, `repo`, `branch`, `model`, `profile`, `score`, `findingCounts`, and optional `label` (for batch reviews) are stored per entry

### UI

| Component | Description |
|-----------|-------------|
| Status bar | Shows `$(check|warning|error) N/100` after every review; click to open history panel |
| History panel | Line chart (Chart.js CDN) of last N scores, summary cards (latest / average / best), and a sortable table |

### Exported Functions (`src/reviewScore.ts`)

- `parseFindingCounts(reviewText)` — heuristic extraction of severity counts from review Markdown
- `computeScore(counts)` — returns `{ score, correctness, security, maintainability, performance }`
- `ReviewScoreStore.getInstance(storagePath)` — singleton store with `addScore()`, `getScores()`, `getLastScore()`, `clear()`
- `updateScoreStatusBar(item, score)` — update the status bar item text and color
- `ReviewHistoryPanel.createOrShow(scores)` — open or focus the history webview

## Agentic Multi-Step Reviews (F-007)

The `src/agent/` module transforms single-pass reviews into a 5-step agentic pipeline that produces deeper, more accurate reviews by analysing context and self-critiquing.

### Pipeline Steps

| Step | Name | Type | Description |
|------|------|------|-------------|
| 1 | Analyze Diff | Local | Parses diff into per-file metadata, detects change types (feature, bugfix, refactor, etc.) |
| 2 | Gather Context | Local + I/O | Leverages F-008 context gathering for imports, tests, type defs; discovers workspace patterns |
| 3 | Pattern Analysis | AI | Identifies codebase conventions (naming, imports, error handling, testing patterns) |
| 4 | Deep Review | AI | Comprehensive review with security, bugs, performance, and maintainability focus |
| 5 | Synthesis | AI | Self-critique pass: removes false positives, prioritises findings, adds summary |

### Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `enabled` | `false` | Enable the multi-step agentic review pipeline |
| `maxContextFiles` | `10` | Max context files to resolve in step 2 |
| `includeTests` | `true` | Include test files in context gathering |
| `includeTypes` | `true` | Include `.d.ts` type definitions in context |
| `selfCritique` | `true` | Run self-critique in step 5 to remove false positives |

### Exported Functions (`src/agent/orchestrator.ts`)

- `runAgentReview(diff, extensionContext, outputChannel, callAI, reportProgress, cancellationToken, profileContext?, skillContext?)` — Main pipeline orchestrator
- `getAgentModeConfig()` — Read agent config from VS Code settings
- `DEFAULT_AGENT_CONFIG` — Default configuration values

### Key Types (`src/agent/types.ts`)

```typescript
interface AgentModeConfig {
  enabled: boolean;
  maxContextFiles: number;
  includeTests: boolean;
  includeTypes: boolean;
  selfCritique: boolean;
}

interface AgentStep<TInput, TOutput> {
  name: string;
  label: string;
  execute(input: TInput, ctx: AgentContext): Promise<TOutput>;
}

interface AgentReviewResult {
  review: string;
  diffAnalysis: DiffAnalysis;
  gatheredContext: GatheredContext;
  patternAnalysis: PatternAnalysis;
  deepReview: DeepReview;
  synthesis: SynthesisResult;
  durationMs: number;
  stepsCompleted: number;
}
```

### Graceful Degradation

- Steps 1–3 are non-fatal: if any fail, the pipeline continues with empty results
- Step 4 (deep review) is critical: failure aborts the pipeline
- Step 5 (synthesis) falls back to the raw deep review if self-critique fails
- Cancellation is checked between every step
- Progress is reported for each step via VS Code notification

## Architecture Diagram Generation (F-020)

The `src/diagramGenerator.ts` module generates Mermaid.js diagrams from code diffs or files. Diagrams are rendered in the review panel using the Mermaid.js CDN.

### How It Works

1. The user clicks the "📊 Diagram" button in the review panel toolbar (or runs the command from the palette)
2. The current review diff (or staged changes) is sent to the AI with a diagram-specific prompt
3. The AI selects the best diagram type and outputs valid Mermaid syntax
4. The Mermaid.js CDN renders the diagram in the review panel
5. A "Copy Source" button allows copying the raw Mermaid code

### Supported Diagram Types

| Type | When Used |
|------|-----------|
| `classDiagram` | Classes, interfaces, type relationships |
| `flowchart TD` | Function call chains, control flow |
| `sequenceDiagram` | API calls, async patterns, request/response |
| `graph TD` | Import/module dependency graphs |

### Exported Functions (`src/diagramGenerator.ts`)

- `generateMermaidDiagram(codeContent, callAI)` — Generate a Mermaid diagram; returns `DiagramResult`

### DiagramResult Interface

```typescript
interface DiagramResult {
  mermaidCode: string;    // Raw Mermaid source (empty if failed)
  diagramType: string;    // e.g., 'classDiagram', 'flowchart'
  valid: boolean;         // Basic syntax validation
}
```

### Review Panel Integration

- Mermaid.js v10 CDN loaded alongside highlight.js and marked.js
- `<div class="mermaid">` elements are auto-detected and rendered
- Copy Source button extracts raw Mermaid from `data-mermaid-source` attribute
- Invalid Mermaid syntax shows error message with raw source as fallback

## Review History & Analytics (F-011)

The `src/analytics/` module provides comprehensive review analytics by extending the F-016 scoring system with richer metadata tracking, category-level issue analysis, and a multi-chart dashboard.

### How It Works

1. Each review now captures additional metadata: duration, review type, files reviewed, and issue categories
2. Issue categories are extracted by scanning review text for domain-specific keywords (security, performance, bugs, style, etc.)
3. The analytics dashboard aggregates all stored review scores into summary cards, charts, and tables
4. Data can be exported as CSV or JSON for external analysis

### Enhanced ReviewScore Fields (F-011 additions)

| Field | Type | Description |
|-------|------|-------------|
| `durationMs` | `number?` | Review wall-clock duration in milliseconds |
| `reviewType` | `ReviewType?` | One of: `staged`, `commit`, `commit-range`, `branch-compare`, `pr`, `file`, `folder`, `selection`, `agent` |
| `filesReviewed` | `string[]?` | File paths extracted from the diff |
| `categories` | `Record<IssueCategory, number>?` | Issue category counts: `security`, `performance`, `style`, `bugs`, `maintainability`, `accessibility`, `documentation`, `other` |

### Analytics Dashboard

Opened via `ollama-code-review.showAnalyticsDashboard` command. Features:

| Component | Type | Description |
|-----------|------|-------------|
| Summary cards | Grid | Total reviews, avg score, best score, total issues, this week, this month |
| Score trend | Line chart | Score over all reviews (Chart.js) |
| Severity distribution | Doughnut chart | Critical / High / Medium / Low / Info breakdown |
| Category distribution | Horizontal bar | Issues grouped by category (security, performance, bugs, etc.) |
| Review types | Doughnut chart | Breakdown by review type (staged, commit, PR, file, etc.) |
| Model usage | Horizontal bar | Reviews per AI model |
| Most reviewed files | Table | Top 15 most-reviewed files |
| Profile usage | Table | Review count and percentage per profile |
| Weekly activity | Table | Reviews and avg score per week (last 12 weeks) |
| Export | Buttons | Export all data as CSV or JSON |

### Exported Functions (`src/analytics/tracker.ts`)

- `parseIssueCategories(reviewText)` — Extract issue category counts from AI review Markdown
- `extractFilesFromDiff(diff)` — Extract file paths from unified diff `+++ b/...` headers
- `computeAnalytics(scores)` — Compute comprehensive `AnalyticsSummary` from full score history
- `exportAsCSV(scores)` — Serialize review scores to CSV string
- `exportAsJSON(scores)` — Serialize review scores to JSON string

### Exported Class (`src/analytics/dashboard.ts`)

- `AnalyticsDashboardPanel.createOrShow(scores)` — Open or focus the analytics dashboard webview

### Storage

Analytics data is stored alongside F-016 scores in `{globalStorage}/review-scores.json`. The store limit has been increased from 200 to 500 entries. No new database dependency is required.

## Team Knowledge Base (F-012)

The `src/knowledge/` module allows teams to encode architecture decisions, coding patterns, and review rules in a `.ollama-review-knowledge.yaml` file checked into the repository. The AI references these entries during reviews to enforce team conventions consistently.

### How It Works

1. The extension loads `.ollama-review-knowledge.yaml` from the workspace root on startup
2. A file watcher auto-reloads the knowledge on create, change, or delete events
3. When a review runs, knowledge entries are matched against the diff using keyword relevance scoring
4. Relevant decisions, patterns, and rules are injected into the review prompt
5. The AI cites specific entry IDs when flagging violations

### Knowledge Entry Types

| Type | Required Fields | Purpose |
|------|----------------|---------|
| **Decisions** | `id`, `title`, `decision` | Architecture Decision Records the AI checks code against |
| **Patterns** | `id`, `name`, `description` | Reusable code patterns with optional examples |
| **Rules** | (plain string) | Universal team conventions — always injected into reviews |

### .ollama-review-knowledge.yaml Schema

```yaml
decisions:
  - id: ADR-001
    title: Use Redux for state management
    context: Need consistent state across the app
    decision: All global state must be managed through Redux
    date: "2024-01-15"
    tags: [state, redux, react]

patterns:
  - id: PAT-001
    name: API error handling
    description: Standard try/catch with toast notification
    tags: [error-handling, api]
    example: |
      try {
        const data = await api.fetch('/endpoint');
      } catch (error) {
        toast.error(error.message);
        logger.error(error);
      }

rules:
  - Always use TypeScript strict mode
  - Prefer named exports over default exports
  - Tests required for business logic
```

### Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `enabled` | `true` | Load and inject knowledge base entries into reviews |
| `maxEntries` | `10` | Maximum number of knowledge entries per review (1–50) |

### Exported Functions (`src/knowledge/loader.ts`)

- `loadKnowledgeBase(outputChannel?)` — Read and parse `.ollama-review-knowledge.yaml` from workspace root; workspace-aware caching
- `clearKnowledgeCache()` — Invalidate the cached knowledge (called by file watcher and `reloadKnowledgeBase` command)
- `getKnowledgeBaseConfig()` — Read knowledge base settings from VS Code configuration
- `formatKnowledgeForPrompt(knowledge, maxEntries?)` — Format knowledge entries into a prompt-ready string section

### Exported Functions (`src/knowledge/matcher.ts`)

- `matchKnowledge(knowledge, content, maxResults?)` — Find relevant knowledge entries for the given code context using keyword-based scoring; returns `KnowledgeMatchResult`

### Key Types (`src/knowledge/types.ts`)

```typescript
interface KnowledgeDecision {
  id: string;
  title: string;
  context?: string;
  decision: string;
  date?: string;
  tags?: string[];
}

interface KnowledgePattern {
  id: string;
  name: string;
  description: string;
  example?: string;
  tags?: string[];
}

type KnowledgeRule = string;

interface KnowledgeYamlConfig {
  decisions?: KnowledgeDecision[];
  patterns?: KnowledgePattern[];
  rules?: KnowledgeRule[];
}

interface MatchedKnowledge {
  type: KnowledgeEntryType;
  title: string;
  content: string;
  relevance: number;
}

interface KnowledgeMatchResult {
  matches: MatchedKnowledge[];
  totalEntries: number;
}

interface KnowledgeBaseConfig {
  enabled: boolean;
  maxEntries: number;
}
```

### Integration

Knowledge is injected automatically during `getOllamaReview()` and `getOllamaFileReview()`. If the knowledge base file doesn't exist or loading fails, the review proceeds without knowledge context (non-fatal). The file watcher pattern mirrors the existing `.ollama-review.yaml` watcher from F-006.

## Related Projects

### MCP Server for Claude Desktop

A standalone MCP (Model Context Protocol) server is available as a separate project, allowing Claude Desktop to directly access code review functionality without copy-pasting diffs.

**Repository:** [ollama-code-review-mcp](https://github.com/pinkpixel-dev/ollama-code-review-mcp)

## GitHub PR Integration (F-004)

The extension can fetch and review GitHub Pull Requests and post AI-generated reviews as PR comments. The GitHub integration is implemented as a dedicated module under `src/github/`.

### Commands

| Command | Description |
|---------|-------------|
| `ollama-code-review.reviewGitHubPR` | Fetch a PR diff by URL or number and open in the review panel |
| `ollama-code-review.postReviewToPR` | Post the current review to the PR as a GitHub comment |

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `ollama-code-review.github.token` | `""` | GitHub PAT with `repo` scope for PR access and posting comments |
| `ollama-code-review.github.commentStyle` | `"summary"` | Comment posting style: `summary`, `inline`, or `both` |

### Comment Styles

- **`summary`**: Posts one top-level PR comment with the full review Markdown.
- **`inline`**: Attempts to map review findings to specific changed lines and post them as inline review comments.
- **`both`**: Posts a summary comment and inline comments simultaneously.

### Token Scopes

- `github.token` (repo scope) — required for PR reviews and posting comments
- `github.gistToken` (gist scope) — used for creating Gists; falls back to `github.token` if gist scope is not set separately

### GitHub Auth Module (src/github/auth.ts)

Multi-strategy authentication with the following priority order:

1. `gh` CLI (`gh auth token`) — used if `gh` is installed and authenticated
2. VS Code built-in GitHub session (`vscode.authentication.getSession`)
3. Stored `github.token` setting

```typescript
interface GitHubAuth {
  token: string;
  source: 'gh-cli' | 'vscode-session' | 'settings';
}

// Key exports
getGitHubAuth(promptIfNeeded?: boolean): Promise<GitHubAuth | undefined>
showAuthSetupGuide(): void  // Shows error UI with sign-in guidance
```

### PR Review Module (src/github/prReview.ts)

```typescript
interface PRReference {
  owner: string;
  repo: string;
  prNumber: number;
}

interface PRInfo {
  title: string;
  body: string;
  state: string;
  user: string;
  branches: { head: string; base: string };
  stats: { additions: number; deletions: number; changedFiles: number };
  url: string;
}

// Key exports
parsePRInput(input: string, repoContext?: string): PRReference | null
parseRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null
fetchPRDiff(ref: PRReference, auth: GitHubAuth): Promise<string>
fetchPRInfo(ref: PRReference, auth: GitHubAuth): Promise<PRInfo>
postPRSummaryComment(ref, auth, content, model): Promise<string>  // Returns comment URL
postPRReview(ref, auth, findings, content, model): Promise<string>
listOpenPRs(owner, repo, auth): Promise<PRInfo[]>
promptAndFetchPR(repoPath, runGitCommand): Promise<{ diff, prInfo, ref } | undefined>
```

Accepts PR input in these formats: full URL, `#123`, `owner/repo#123`.

### Comment Mapper Module (src/github/commentMapper.ts)

Parses AI review Markdown into structured findings for inline PR comments.

```typescript
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface ReviewFinding {
  severity: Severity;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

// Key exports
parseDiffFileLines(diff: string): Map<string, Set<number>>  // Changed lines per file
parseReviewIntoFindings(reviewMarkdown: string, diff: string): ReviewFinding[]
formatFindingAsComment(finding: ReviewFinding): string  // Emoji severity badges
formatFindingsAsSummary(findings: ReviewFinding[], model: string): string  // Summary table
```

## GitLab & Bitbucket Integration (F-015)

The extension supports reviewing Merge Requests from GitLab and Pull Requests from Bitbucket, mirroring the existing GitHub PR integration (F-004).

### GitLab Module (`src/gitlab/`)

#### Authentication (`src/gitlab/auth.ts`)

Multi-strategy authentication with the following priority order:
1. `glab` CLI (`glab auth status`) — used if `glab` is installed and authenticated
2. Stored `gitlab.token` setting

```typescript
interface GitLabAuth {
  token: string;
  baseUrl: string;
  source: 'glab-cli' | 'settings';
}

// Key exports
getGitLabAuth(promptIfNeeded?: boolean): Promise<GitLabAuth | null>
showGitLabAuthSetupGuide(): void
```

#### MR Review (`src/gitlab/mrReview.ts`)

```typescript
interface MRReference {
  projectPath: string;  // e.g. "owner/repo" or "group/subgroup/project"
  mrNumber: number;
}

interface MRInfo {
  title: string;
  description: string | null;
  state: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

// Key exports
parseMRInput(input: string, projectContext?: string): MRReference | null
parseGitLabRemoteUrl(remoteUrl: string): string | null
isGitLabRemote(remoteUrl: string): boolean
fetchMRDiff(ref: MRReference, auth: GitLabAuth): Promise<string>
fetchMRInfo(ref: MRReference, auth: GitLabAuth): Promise<MRInfo>
postMRComment(ref: MRReference, auth: GitLabAuth, content: string, model: string): Promise<string>
listOpenMRs(projectPath: string, auth: GitLabAuth): Promise<Array<...>>
promptAndFetchMR(repoPath: string, runGitCommand: ...): Promise<{ diff, ref, info, auth } | null>
```

Accepts MR input in these formats: full URL, `!123`, `owner/repo!123`.

#### Self-Hosted GitLab

The `gitlab.baseUrl` setting supports self-hosted GitLab instances. All API calls use `${baseUrl}/api/v4/...` so any GitLab-compatible instance works.

### Bitbucket Module (`src/bitbucket/`)

#### Authentication (`src/bitbucket/auth.ts`)

Uses Bitbucket App Passwords (HTTP Basic Auth):

```typescript
interface BitbucketAuth {
  username: string;
  appPassword: string;
  source: 'settings';
}

// Key exports
getBitbucketAuth(promptIfNeeded?: boolean): Promise<BitbucketAuth | null>
buildBitbucketAuthHeader(auth: BitbucketAuth): string
showBitbucketAuthSetupGuide(): void
```

#### PR Review (`src/bitbucket/prReview.ts`)

```typescript
interface BitbucketPRReference {
  workspace: string;
  repoSlug: string;
  prId: number;
}

interface BitbucketPRInfo {
  title: string;
  description: string | null;
  state: string;
  author: string;
  sourceBranch: string;
  destinationBranch: string;
  webUrl: string;
  taskCount: number;
}

// Key exports
parseBitbucketPRInput(input: string, repoContext?: ...): BitbucketPRReference | null
parseBitbucketRemoteUrl(remoteUrl: string): { workspace, repoSlug } | null
isBitbucketRemote(remoteUrl: string): boolean
fetchBitbucketPRDiff(ref, auth): Promise<string>
fetchBitbucketPRInfo(ref, auth): Promise<BitbucketPRInfo>
postBitbucketPRComment(ref, auth, content, model): Promise<string>
listOpenBitbucketPRs(workspace, repoSlug, auth): Promise<Array<...>>
promptAndFetchBitbucketPR(repoPath, runGitCommand): Promise<{ diff, ref, info, auth } | null>
```

Accepts PR input in these formats: full URL, `#123`, `workspace/repo#123`.

### API Endpoints

| Platform | API Base |
|----------|----------|
| GitLab Cloud | `https://gitlab.com/api/v4` |
| GitLab Self-Hosted | `${gitlab.baseUrl}/api/v4` |
| Bitbucket Cloud | `https://api.bitbucket.org/2.0` |

### Platform Auto-Detection

When the user runs a review command, the extension reads `remote.origin.url` from git config and checks:
- `isGitLabRemote()` — URL contains "gitlab" (not "github" or "bitbucket")
- `isBitbucketRemote()` — URL contains "bitbucket" (not "github" or "gitlab")
- GitHub is detected via the existing `parseRemoteUrl()` function

This enables automatic project context detection and open MR/PR listing.

## Notes

- Cloud models available as fallback when local Ollama unreachable
- Conventional Commits format for generated messages
- Status bar shows current model and active review profile with click-to-switch
- Reviews support follow-up questions via chat interface
- Custom prompt templates supported via settings; agent skills always appended if `${skills}` missing, active profile always appended if `${profile}` missing
- Diff filtering automatically excludes lock files, build output, and minified files from reviews
- Review panel toolbar provides four export options (clipboard, markdown, PR description, GitHub Gist)
- GitHub PR Integration allows reviewing PRs directly and posting results as PR comments
- `.ollama-review.yaml` at the workspace root is the highest-priority config source; checked into the repo so teams share consistent settings
- PHP files are supported for inline code actions (lightbulb menu) and the context menu suggestion command
- GitHub auth falls back gracefully through: `gh` CLI → VS Code session → stored `github.token` setting
- `github.gistToken` falls back to `github.token` if the gist-specific token is not set
- OpenAI-compatible provider supports any server exposing `/v1/chat/completions` — LM Studio, vLLM, LocalAI, Groq, OpenRouter, Together AI — configured via `openaiCompatible.*` settings; API key is optional for local servers
- GitLab integration supports self-hosted instances via `gitlab.baseUrl` setting; auth falls back through `glab` CLI → stored `gitlab.token` setting
- Bitbucket integration uses App Passwords with HTTP Basic Auth; auto-detects Bitbucket remotes for project context
- Platform auto-detection reads `remote.origin.url` and checks for GitHub, GitLab, or Bitbucket patterns to enable context-aware MR/PR listing

## Roadmap & Future Development

See [docs/roadmap/](./docs/roadmap/) for comprehensive planning documents:

| Document | Purpose |
|----------|---------|
| [README.md](./docs/roadmap/README.md) | Roadmap overview, phases, priorities |
| [FEATURES.md](./docs/roadmap/FEATURES.md) | Detailed feature specifications (F-001 to F-027, S-001 to S-005) |
| [ARCHITECTURE.md](./docs/roadmap/ARCHITECTURE.md) | Technical architecture decisions (ADRs) |

### Shipped Features

| Feature | ID | Shipped |
|---------|----|---------|
| Smart Diff Filtering | F-002 | v1.x |
| Inline Code Actions (Explain, Tests, Fix, Docs) | F-005 | v1.18 |
| Customizable Prompts (settings + .ollama-review.yaml) | F-006 | v2.1–v3.4 |
| Multi-Provider Cloud Support (7 providers) | S-001 | v1.10–v1.16 |
| Agent Skills System (multi-repo, multi-skill) | S-002 | v1.18–v1.20 |
| Performance Metrics (per-provider) | S-003 | v1.15 |
| Interactive Chat (multi-turn follow-ups) | S-004 | v1.7 |
| HF Model Picker (recent/popular/custom) | S-005 | v1.15 |
| Review Profiles & Presets (6 built-in + custom) | F-001 | v3.1 |
| Export Options (Copy, Markdown, PR Description, GitHub Gist) | F-003 | v3.2 |
| GitHub PR Integration (review PRs, post comments, inline/summary style) | F-004 | v3.3 |
| Project Config File (.ollama-review.yaml, config hierarchy, file watcher) | F-006 (remainder) | v3.4 |
| PHP Language Support (inline code actions + context menu) | — | v3.4 |
| Multi-strategy GitHub Auth (gh CLI / VS Code session / token) | — | v3.4 |
| OpenAI-Compatible Provider (LM Studio, vLLM, LocalAI, Groq, OpenRouter) | F-013 | v3.5 |
| Pre-Commit Guard (review before commit, severity threshold, hook management) | F-014 | v3.6 |
| Multi-File Contextual Analysis (import resolution, test discovery, type defs) | F-008 | v4.0 |
| Compliance Review Profiles (OWASP Top 10, PCI-DSS, GDPR, HIPAA, SOC2, NIST CSF) | F-017 | v4.0 |
| Review Quality Scoring & Trends (heuristic score, history panel, status bar) | F-016 | v4.1 |
| Notification Integrations (Slack / Microsoft Teams / Discord webhooks) | F-018 | v4.1 |
| Batch / Legacy Code Review (reviewFile, reviewFolder, reviewSelection) | F-019 | v4.1 |
| Agentic Multi-Step Reviews (5-step pipeline, self-critique) | F-007 | v4.2 |
| Architecture Diagram Generation (Mermaid.js, review panel integration) | F-020 | v4.2 |
| Review History & Analytics (dashboard, categories, export, duration tracking) | F-011 | v4.3 |
| Team Knowledge Base (decisions, patterns, rules YAML, keyword matching, prompt injection) | F-012 | v4.4 |
| GitLab & Bitbucket Integration (review MRs/PRs, post comments, platform auto-detection) | F-015 | v4.5 |
| RAG-Enhanced Reviews (semantic codebase indexing, cosine similarity retrieval, TF-IDF fallback) | F-009 | v5.0 |
| CI/CD Integration (headless CLI, GitHub Actions template, GitLab CI template) | F-010 | v5.0 |
| Streaming Responses (Ollama, Claude, OpenAI-compatible; token-by-token review panel; `streaming.enabled` setting) | F-022 | v6.0 |
| Rules Directory (`.ollama-review/rules/*.md`; plain-Markdown team rules; file watcher; coexists with F-012) | F-026 | v6.0 |
| Provider Abstraction Layer (`ModelProvider` interface + `ProviderRegistry` for all 8 providers) | F-025 | v6.0 |
| Inline Edit Mode (Ctrl+Shift+K; natural-language description; streaming side-by-side diff preview; accept/reject) | F-024 | v6.0 |

### Phase 6: AI Assistant Evolution (In Progress — v6.0)

| Feature | ID | Priority | Effort | Status | Description |
|---------|----|----------|--------|--------|-------------|
| Streaming Responses | F-022 | P1 | Medium (3-5 days) | ✅ Complete | SSE/NDJSON streaming for Ollama, Claude, OpenAI-compatible; incremental review panel rendering |
| Rules Directory | F-026 | P3 | Low (1-2 days) | ✅ Complete | `.ollama-review/rules/*.md` files always injected into review prompts |
| extension.ts Decomposition | F-027 | P0 | Medium (3-5 days) | ✅ Complete | Split monolithic `extension.ts` into `commands/index.ts`, `commands/providerClients.ts`, `commands/aiActions.ts`, `commands/uiHelpers.ts` with `extension.ts` as thin loader |
| Sidebar Chat Panel | F-021 | P1 | High (7-10 days) | ✅ Complete | Persistent `WebviewViewProvider` sidebar chat with conversation history, model switching, `/staged`, `/help` commands, and review panel "Discuss" integration |
| @-Context Mentions in Chat | F-023 | P2 | Medium (4-5 days) | ✅ Complete | `@file` (file picker), `@diff`, `@selection`, `@review`, `@knowledge` context providers with autocomplete dropdown in sidebar chat |
| Provider Abstraction Layer | F-025 | P0 | Medium (3-4 days) | ✅ Complete | Unified `ModelProvider` interface + `ProviderRegistry` for all 8 providers |
| Inline Edit Mode | F-024 | P2 | High (5-7 days) | ✅ Complete | Highlight code, describe change, AI applies edit with streaming inline diff preview |
