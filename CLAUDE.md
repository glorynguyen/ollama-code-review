# Ollama Code Review - Project Knowledge Base

## Project Overview

- **Name:** Ollama Code Review VS Code Extension
- **Version:** 3.0.0
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
├── diffFilter.ts         # Diff filtering & ignore patterns (F-002)
├── utils.ts              # Config helper functions
├── codeActions/          # Inline AI code actions (F-005)
│   ├── index.ts          # Module exports
│   ├── types.ts          # Common types and utilities
│   ├── explainAction.ts  # Explain Code action provider
│   ├── testAction.ts     # Generate Tests action provider
│   ├── fixAction.ts      # Fix Issue action provider
│   └── documentAction.ts # Add Documentation action provider
└── test/
    └── extension.test.ts # Mocha test suite

out/                      # Compiled JavaScript output
.github/workflows/        # CI/CD (semantic-release)
```

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/extension.ts` | ~2,533 | Main extension logic, all commands, Git operations |
| `src/reviewProvider.ts` | ~497 | Webview for displaying reviews with chat interface |
| `src/skillsService.ts` | ~593 | Fetches/caches agent skills from GitHub repos |
| `src/skillsBrowserPanel.ts` | ~516 | UI for browsing and downloading skills |
| `src/diffFilter.ts` | ~221 | Diff filtering with ignore patterns and formatting detection |
| `src/utils.ts` | ~33 | Helper for model config, HTML escaping, and prompt template resolution |
| `src/codeActions/index.ts` | ~34 | Module barrel exports for code actions |
| `src/codeActions/explainAction.ts` | ~160 | Explain Code action with preview panel |
| `src/codeActions/testAction.ts` | ~367 | Generate Tests action with framework detection |
| `src/codeActions/fixAction.ts` | ~422 | Fix Issue action with diff preview |
| `src/codeActions/documentAction.ts` | ~369 | Add Documentation action with preview |
| `src/codeActions/types.ts` | ~103 | Common types and parsing utilities |

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
| `ollama-code-review.explainCode` | Explain selected code in preview panel |
| `ollama-code-review.generateTests` | Generate unit tests for selected code |
| `ollama-code-review.fixIssue` | Fix diagnostics or selected code with diff preview |
| `ollama-code-review.fixSelection` | Fix selected code |
| `ollama-code-review.addDocumentation` | Generate JSDoc/TSDoc for functions/classes |
| `ollama-code-review.browseAgentSkills` | Browse and download agent skills |
| `ollama-code-review.applySkillToReview` | Apply multiple skills to reviews (multi-select supported) |
| `ollama-code-review.clearSelectedSkills` | Clear all selected skills |

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
| `ollama-code-review.endpoint` | `http://localhost:11434/api/generate` | Ollama API endpoint |
| `ollama-code-review.temperature` | `0` | Model temperature (0-1) |
| `ollama-code-review.frameworks` | `["React"]` | Target frameworks for context |
| `ollama-code-review.diffFilter` | `{}` | Diff filtering configuration (see Diff Filtering section) |
| `ollama-code-review.prompt.review` | (built-in review prompt) | Custom prompt template for code reviews. Variables: `${code}`, `${frameworks}`, `${skills}` |
| `ollama-code-review.prompt.commitMessage` | (built-in commit prompt) | Custom prompt template for commit messages. Variables: `${diff}`, `${draftMessage}` |
| `ollama-code-review.skills.defaultRepository` | `vercel-labs/agent-skills` | Default GitHub repo for skills |
| `ollama-code-review.skills.additionalRepositories` | `[]` | Additional GitHub repos for skills |
| `ollama-code-review.skills.autoApply` | `true` | Auto-apply selected skill |

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

### Local Ollama Models
Any model available in your local Ollama instance will be auto-discovered. The predefined local model in settings is `qwen2.5-coder:14b-instruct-q4_0`.

## Architecture

### Extension Activation
1. Activates on: JS/TS/JSX/TSX files or SCM view
2. Entry: `activate()` in `extension.ts`
3. Registers all commands and status bar items

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

## Key Functions in extension.ts

### Model Detection
- `isClaudeModel()` - Check if model is a Claude model
- `isGlmModel()` - Check if model is a GLM model
- `isHuggingFaceModel()` - Check if model is Hugging Face
- `isGeminiModel()` - Check if model is Gemini
- `isMistralModel()` - Check if model is Mistral
- `isMiniMaxModel()` - Check if model is MiniMax

### API Callers
- `callClaudeAPI()` - Call Anthropic Claude API
- `callGlmAPI()` - Call Z.AI GLM API
- `callHuggingFaceAPI()` - Call Hugging Face Inference API
- `callGeminiAPI()` - Call Google Gemini API
- `callMistralAPI()` - Call Mistral AI API
- `callMiniMaxAPI()` - Call MiniMax API

### Core Workflow
- `activate()` - Extension entry, command registration
- `runReview()` - Execute code review workflow
- `getOllamaReview()` - Call Ollama API for review
- `getOllamaCommitMessage()` - Generate commit message
- `getOllamaSuggestion()` - Get code suggestions
- `selectRepository()` - Handle multi-repo workspaces
- `runGitCommand()` - Execute git operations

### Code Action Handlers
- `getExplanation()` - Get AI explanation for selected code
- `generateTests()` - Generate unit tests for selected code
- `generateFix()` - Generate fix for diagnostics or selected code
- `generateDocumentation()` - Generate JSDoc/TSDoc for functions/classes

### Performance & Model Management
- `getLastPerformanceMetrics()` - Retrieve captured metrics from last API call
- `clearPerformanceMetrics()` - Reset metrics state
- `checkActiveModels()` - Query Ollama's `/api/ps` for active model info (VRAM usage)
- `showHfModelPicker()` - Display HF model selection submenu with recent/popular/custom options
- `getRecentHfModels()` - Get recently used HF models from globalState
- `addRecentHfModel()` - Add a model to recent HF models list
- `updateModelStatusBar()` - Update status bar with current model name

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

### PerformanceMetrics Interface (src/extension.ts)

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

  // Computed metrics
  tokensPerSecond?: number;
  totalDurationSeconds?: number;
  model?: string;
  provider?: 'ollama' | 'claude' | 'glm' | 'huggingface' | 'gemini' | 'mistral' | 'minimax';

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

## Related Projects

### MCP Server for Claude Desktop

A standalone MCP (Model Context Protocol) server is available as a separate project, allowing Claude Desktop to directly access code review functionality without copy-pasting diffs.

**Repository:** [ollama-code-review-mcp](https://github.com/pinkpixel-dev/ollama-code-review-mcp)

## Notes

- Cloud models available as fallback when local Ollama unreachable
- Conventional Commits format for generated messages
- Status bar shows current model with click-to-switch
- Reviews support follow-up questions via chat interface
- Custom prompt templates supported via settings; agent skills are always appended if `${skills}` placeholder is missing from template
- Diff filtering automatically excludes lock files, build output, and minified files from reviews

## Roadmap & Future Development

See [docs/roadmap/](./docs/roadmap/) for comprehensive planning documents:

| Document | Purpose |
|----------|---------|
| [README.md](./docs/roadmap/README.md) | Roadmap overview, phases, priorities |
| [FEATURES.md](./docs/roadmap/FEATURES.md) | Detailed feature specifications (F-001 to F-012, S-001 to S-005) |
| [ARCHITECTURE.md](./docs/roadmap/ARCHITECTURE.md) | Technical architecture decisions (ADRs) |

### Shipped Features

| Feature | ID | Shipped |
|---------|----|---------|
| Smart Diff Filtering | F-002 | v1.x |
| Inline Code Actions (Explain, Tests, Fix, Docs) | F-005 | v1.18 |
| Customizable Prompts (settings, partial — no .yaml) | F-006 | v2.1 |
| Multi-Provider Cloud Support (7 providers) | S-001 | v1.10–v1.16 |
| Agent Skills System (multi-repo, multi-skill) | S-002 | v1.18–v1.20 |
| Performance Metrics (per-provider) | S-003 | v1.15 |
| Interactive Chat (multi-turn follow-ups) | S-004 | v1.7 |
| HF Model Picker (recent/popular/custom) | S-005 | v1.15 |

### Remaining Planned Features

| Phase | Features | Target |
|-------|----------|--------|
| v3.1 | Review Profiles (F-001), Export Options (F-003) | Q1 2026 |
| v3.5 | GitHub PR Integration (F-004), F-006 remainder (.yaml config) | Q2 2026 |
| v4.0 | Agentic Multi-Step Reviews (F-007), Multi-File Analysis (F-008) | Q3 2026 |
| v5.0 | RAG (F-009), CI/CD (F-010), Analytics (F-011), Knowledge Base (F-012) | Q4 2026 |
