# Feature Specifications

> **Document Version:** 4.0.0
> **Last Updated:** 2026-02-21

This document contains detailed specifications for each planned feature. Each feature has a unique ID for tracking and reference.

---

## Table of Contents

- [Shipped Features (Not in Original Roadmap)](#shipped-features-not-in-original-roadmap)
- [Phase 1: Foundation Enhancements](#phase-1-foundation-enhancements-v20)
- [Phase 2: Workflow Integration](#phase-2-workflow-integration-v25)
- [Phase 3: Intelligence Layer](#phase-3-intelligence-layer-v30)
- [Phase 4: Enterprise Features](#phase-4-enterprise-features-v40)
- [Phase 5: Developer Experience & Ecosystem](#phase-5-developer-experience--ecosystem-v60)

---

## Shipped Features (Not in Original Roadmap)

The following significant features were implemented organically during development and were not part of the original roadmap. They are documented here for completeness.

### S-001: Multi-Provider Cloud Model Support

| Attribute | Value |
|-----------|-------|
| **ID** | S-001 |
| **Status** | ✅ Complete |
| **Shipped** | v1.10.0 – v1.16.0 (Jan 2026) |

Seven cloud/local providers fully integrated with dedicated API callers, model detection, and token counting:

| Provider | Models | API Key Setting |
|----------|--------|-----------------|
| Ollama (local) | Any locally available model | N/A |
| Claude (Anthropic) | claude-sonnet-4, claude-opus-4, claude-3.7-sonnet | `claudeApiKey` |
| GLM (Z.AI) | glm-4.7-flash, glm-4.7:cloud | `glmApiKey` |
| Hugging Face | 7+ popular models + custom | `hfApiKey` |
| Gemini (Google AI) | gemini-2.5-flash, gemini-2.5-pro | `geminiApiKey` |
| Mistral AI | mistral-large, mistral-small, codestral | `mistralApiKey` |
| MiniMax | MiniMax-M2.5 | `minimaxApiKey` |

**Implementation:** Model detection functions (`isClaudeModel()`, etc.) and dedicated API callers (`callClaudeAPI()`, etc.) in `src/extension.ts`.

---

### S-002: Agent Skills System

| Attribute | Value |
|-----------|-------|
| **ID** | S-002 |
| **Status** | ✅ Complete |
| **Shipped** | v1.18.0 – v1.20.0 (Jan–Feb 2026) |

Download and apply AI agent skills from GitHub repositories to augment review prompts.

**Key capabilities:**
- Multi-skill selection with QuickPick dialog (numbered headers in prompts)
- Multi-repository support (default + additional repos configurable)
- Skills browser webview with search filtering and repo source display
- Local caching in extension global storage with YAML frontmatter parsing
- Dynamic ESM import for `@octokit/rest`

**Files:** `src/skillsService.ts` (593 lines), `src/skillsBrowserPanel.ts` (516 lines)
**Commands:** `browseAgentSkills`, `applySkillToReview`, `clearSelectedSkills`

---

### S-003: Performance Metrics System

| Attribute | Value |
|-----------|-------|
| **ID** | S-003 |
| **Status** | ✅ Complete |
| **Shipped** | v1.15.0 (Jan 2026) |

Captures and displays per-provider performance metrics in a collapsible "System Info" panel in the review webview.

**Metrics by provider:** Token counts (input/output), duration, tokens/sec (Ollama), VRAM usage (Ollama), rate limit info (HF).

**Implementation:** `PerformanceMetrics` interface in `src/extension.ts`, display logic in `src/reviewProvider.ts`.

---

### S-004: Interactive Chat in Review Panel

| Attribute | Value |
|-----------|-------|
| **ID** | S-004 |
| **Status** | ✅ Complete |
| **Shipped** | v1.7.0 (Jan 2026) |

Multi-turn follow-up questions on review results with conversation history tracking.

**Supports:** Claude, MiniMax, and Ollama providers for chat follow-ups. System message injects original diff context. Multi-skill guidelines included in follow-up prompts.

**Implementation:** `_conversationHistory` and `_getFollowUpResponse()` in `src/reviewProvider.ts`.

---

### S-005: Hugging Face Model Picker

| Attribute | Value |
|-----------|-------|
| **ID** | S-005 |
| **Status** | ✅ Complete |
| **Shipped** | v1.15.0 (Jan 2026) |

Submenu for HF model selection with recently used models (stored in globalState), configurable popular models list, and custom model input.

**Implementation:** `showHfModelPicker()`, `getRecentHfModels()`, `addRecentHfModel()` in `src/extension.ts`.

---

## Phase 1: Foundation Enhancements (v2.0)

### F-001: Review Profiles & Presets

| Attribute | Value |
|-----------|-------|
| **ID** | F-001 |
| **Priority** | 🔴 P0 |
| **Effort** | Medium (2-3 days) |
| **Status** | ✅ Complete |
| **Shipped** | v3.1.0 (Feb 2026) |
| **Dependencies** | None |

#### Description

Six built-in review profiles that adjust the AI's focus area and severity level, plus support for user-defined custom profiles.

#### Built-in Profiles

| Profile | Focus Areas | Severity |
|---------|-------------|----------|
| `general` | Best practices, readability, bugs, naming | balanced |
| `security` | Injection, XSS/CSRF, auth, secrets, crypto, path traversal | strict |
| `performance` | Memory leaks, N+1 queries, complexity, re-renders, caching | balanced |
| `accessibility` | ARIA, keyboard nav, color contrast, screen readers, semantic HTML | balanced |
| `educational` | Readability, design patterns, pitfalls, idioms, testing | lenient |
| `strict` | All issues including edge cases, types, coverage, docs | strict |

#### Implementation

- **Module:** `src/profiles.ts` — profile types, built-in definitions, CRUD for custom profiles, prompt context builder
- **Status bar:** Profile selector item (shield icon) next to model selector, click to switch
- **Command:** `ollama-code-review.selectProfile` — QuickPick with all profiles, create/delete custom profiles
- **Prompt integration:** `${profile}` template variable injected into review prompts; auto-appended if not in custom template
- **Webview:** Active profile shown in System Info panel (when non-general)
- **Persistence:** Active profile name stored in `globalState`; custom profiles stored in `globalState` + `customProfiles` setting
- **Config:** `ollama-code-review.customProfiles` array setting for defining profiles in settings.json

#### Acceptance Criteria

- [x] User can select profile from command palette
- [x] Profile shown in status bar
- [x] Reviews reflect profile focus areas
- [x] Custom profiles can be defined in settings
- [x] Profile persists across sessions

---

### F-002: Smart Diff Filtering

| Attribute | Value |
|-----------|-------|
| **ID** | F-002 |
| **Priority** | 🔴 P0 |
| **Effort** | Low (1 day) |
| **Status** | ✅ Complete |
| **Dependencies** | None |

#### Description

Automatically filter out noise from diffs before sending to AI. Reduces token usage and improves review relevance.

#### Filter Rules

| Rule | Pattern | Default |
|------|---------|---------|
| Lock files | `*.lock`, `package-lock.json`, `yarn.lock` | ✅ Ignore |
| Build outputs | `dist/`, `build/`, `out/`, `.next/` | ✅ Ignore |
| Generated code | `*.generated.*`, `*.g.ts` | ✅ Ignore |
| Formatting only | Whitespace-only changes | ⚙️ Configurable |
| Large files | Files > 500 lines changed | ⚙️ Warn |
| Binary files | Images, fonts, etc. | ✅ Ignore |

#### Configuration Schema

```json
{
  "ollama-code-review.diffFilter": {
    "type": "object",
    "properties": {
      "ignorePaths": {
        "type": "array",
        "default": ["**/node_modules/**", "**/*.lock", "**/dist/**"]
      },
      "ignorePatterns": {
        "type": "array",
        "default": ["*.min.js", "*.map"]
      },
      "maxFileSize": {
        "type": "number",
        "default": 500,
        "description": "Max lines changed per file before warning"
      },
      "ignoreFormattingOnly": {
        "type": "boolean",
        "default": false
      }
    }
  }
}
```

#### Implementation Notes

1. Add filtering logic before `runReview()` processes diff
2. Show summary of filtered files in review output
3. Allow user to override and include filtered files

#### Files to Modify

- `src/extension.ts` - Add filter logic in `runReview()`
- `package.json` - Add configuration schema
- New: `src/diffFilter.ts` - Filter implementation

#### Acceptance Criteria

- [x] Lock files automatically excluded
- [x] User can configure ignore patterns
- [x] Summary shows "X files filtered"
- [x] User can force-include filtered files

---

### F-003: Export Options

| Attribute | Value |
|-----------|-------|
| **ID** | F-003 |
| **Priority** | 🟠 P1 |
| **Effort** | Low (1 day) |
| **Status** | ✅ Complete |
| **Shipped** | v3.1.0 (Feb 2026) |
| **Dependencies** | None |

#### Description

Allow users to export review results in various formats for sharing, documentation, or integration with other tools.

#### Export Formats

| Format | Use Case | Implementation |
|--------|----------|----------------|
| Markdown | Documentation, GitHub | Native (already markdown) |
| PDF | Formal reports | Use `markdown-pdf` or similar |
| JSON | API integration | Structured output |
| GitHub Gist | Quick sharing | GitHub API |
| Clipboard | Paste anywhere | VS Code API |

#### UI Integration

Add export button to review webview panel with dropdown:
- Copy to Clipboard
- Save as Markdown
- Save as PDF
- Create GitHub Gist
- Copy as PR Description (formatted)

#### Implementation Notes

1. Add export buttons to `reviewProvider.ts` webview
2. Handle export actions via webview messaging
3. For Gist: Use existing `@octokit/rest` dependency

#### Files to Modify

- `src/reviewProvider.ts` - Add export UI and handlers
- `src/extension.ts` - Add export command handlers
- `package.json` - Add commands

#### Acceptance Criteria

- [x] Export button visible in review panel
- [x] Markdown export works
- [x] Clipboard copy works
- [x] GitHub Gist creation works (if authenticated)

---

## Phase 2: Workflow Integration (v2.5)

### F-004: GitHub PR Integration

| Attribute | Value |
|-----------|-------|
| **ID** | F-004 |
| **Priority** | 🟠 P1 |
| **Effort** | High (5-7 days) |
| **Status** | ✅ Complete |
| **Shipped** | v3.3.0 (Feb 2026) |
| **Dependencies** | F-001 (for profile selection in PR context) |

#### Description

Integrate directly with GitHub Pull Requests to post review comments, suggest changes, and track review status.

#### Implementation

- **Module:** `src/github/` — `auth.ts`, `prReview.ts`, `commentMapper.ts`
- **Auth:** Multi-strategy: `gh` CLI → VS Code session → stored `github.token` setting
- **Comment styles:** `summary` (single PR comment), `inline` (per-line review comments), `both`
- **PR input formats:** Full URL, `#123`, `owner/repo#123`
- **Commands:** `reviewGitHubPR`, `postReviewToPR`
- **Settings:** `github.token`, `github.commentStyle`, `github.gistToken`

#### Acceptance Criteria

- [x] Can fetch PR by URL
- [x] Review displays PR context
- [x] Can post summary comment to PR
- [x] Can post inline comments
- [x] Handles authentication gracefully

---

### F-005: Inline Code Actions

| Attribute | Value |
|-----------|-------|
| **ID** | F-005 |
| **Priority** | 🟠 P1 |
| **Effort** | Medium (3-4 days) |
| **Status** | ✅ Complete |
| **Shipped** | v1.18.0 (Jan 2026) |
| **Dependencies** | None |

#### Description

Four AI-powered code actions accessible via the lightbulb menu, context menu, or `Ctrl+.`.

#### Implemented Actions

| Action | Provider | File | Lines |
|--------|----------|------|-------|
| Explain Code | `ExplainCodeActionProvider` | `src/codeActions/explainAction.ts` | 160 |
| Generate Tests | `GenerateTestsActionProvider` | `src/codeActions/testAction.ts` | 367 |
| Fix Issue | `FixIssueActionProvider` | `src/codeActions/fixAction.ts` | 422 |
| Add Documentation | `AddDocumentationActionProvider` | `src/codeActions/documentAction.ts` | 369 |

Each action has a dedicated webview preview panel. Fix tracking via `FixTracker` singleton. Test generation includes framework detection (`detectTestFramework()`). Documentation supports JSDoc vs TSDoc based on file type.

**Shared types:** `src/codeActions/types.ts` (103 lines) — `CodeActionResult`, `TestGenerationResult`, `DocumentationResult`, parsing utilities.

#### Acceptance Criteria

- [x] "Fix This Issue" applies changes with diff preview
- [x] "Explain This Code" shows explanation panel with syntax highlighting
- [x] "Generate Tests" creates test file with framework detection
- [x] "Add Documentation" generates JSDoc/TSDoc with preview
- [x] Actions available in context menu and via lightbulb

---

### F-006: Customizable Prompts

| Attribute | Value |
|-----------|-------|
| **ID** | F-006 |
| **Priority** | 🟠 P1 |
| **Effort** | Low (1-2 days) |
| **Status** | ✅ Complete |
| **Shipped** | v2.1.0 (settings), v3.4.0 (.yaml config + file watcher) |
| **Dependencies** | None |

#### Description

Users can customize the system prompts used for reviews and commit messages via VS Code settings with variable interpolation.

#### What Was Implemented

**Settings (in `package.json`):**
- `ollama-code-review.prompt.review` — Custom review prompt template (multiline text)
- `ollama-code-review.prompt.commitMessage` — Custom commit message prompt template

**Template variables:** `${code}`, `${frameworks}`, `${skills}`, `${diff}`, `${draftMessage}`

**Implementation:** `resolvePrompt(template, variables)` in `src/utils.ts` replaces `${variable}` placeholders. Agent skills are always appended if `${skills}` placeholder is missing from the template.

#### Remaining Scope (Shipped in v3.4.0)

- `.ollama-review.yaml` config file loading implemented in `src/config/promptLoader.ts`
- Three-tier config hierarchy: built-in defaults → VS Code settings → `.ollama-review.yaml`
- Workspace-aware caching with file watcher for auto-reload
- `reloadProjectConfig` command for manual cache invalidation

#### Acceptance Criteria

- [x] User can override prompts in settings
- [x] `.ollama-review.yaml` loaded if present
- [x] Variables interpolated correctly
- [x] Config hierarchy merges defaults → settings → YAML correctly

---

## Phase 3: Intelligence Layer (v3.0)

### F-007: Agentic Multi-Step Reviews

| Attribute | Value |
|-----------|-------|
| **ID** | F-007 |
| **Priority** | 🟡 P2 |
| **Effort** | High (7-10 days) |
| **Status** | ✅ Complete |
| **Shipped** | v4.2.0 (Feb 2026) |
| **Dependencies** | F-006 (customizable prompts), F-008 (context gathering) |

#### Description

Transform the single-pass review into a multi-step agentic workflow that gathers context, analyzes patterns, and produces more insightful reviews.

#### Implementation

- **Module:** `src/agent/` — `orchestrator.ts`, `types.ts`, `index.ts`, `steps/` directory
- **5-step pipeline:** analyzeDiff (local) → gatherContext (local+I/O) → patternAnalysis (AI) → deepReview (AI) → synthesis (AI)
- **Graceful degradation:** Steps 1-3 non-fatal, Step 4 critical, Step 5 falls back to raw deep review
- **Configuration:** `agentMode.enabled`, `maxContextFiles`, `includeTests`, `includeTypes`, `selfCritique`
- **Command:** `ollama-code-review.agentReview`

#### Acceptance Criteria

- [x] Agent completes all steps for simple diffs
- [x] Progress shown for each step
- [x] Context gathering improves review quality
- [x] Can be cancelled mid-process
- [x] Fallback to simple review if agent fails

---

### F-008: Multi-File Contextual Analysis

| Attribute | Value |
|-----------|-------|
| **ID** | F-008 |
| **Priority** | 🟡 P2 |
| **Effort** | Medium (4-5 days) |
| **Status** | ✅ Complete |
| **Shipped** | v4.0.0 (Feb 2026) |
| **Dependencies** | None |

#### Description

Analyze related files beyond the diff to understand the full impact of changes. Identify imports, dependencies, and affected code paths.

#### Implementation

- **Module:** `src/context/` — `contextGatherer.ts`, `importParser.ts`, `fileResolver.ts`, `testDiscovery.ts`, `types.ts`, `index.ts`
- **Import parsing:** ES6 static/dynamic, CommonJS require, re-exports
- **File resolution:** TypeScript-style (appended extensions, directory index files)
- **Test discovery:** Co-located, mirror dirs, root-level by naming conventions
- **Token budget:** 8,000 chars per file, 32,000 chars total
- **Configuration:** `contextGathering.enabled`, `maxFiles`, `includeTests`, `includeTypeDefinitions`
- **Integration:** Auto-gathered during `runReview()` and Review & Commit workflow; non-fatal on failure

#### Acceptance Criteria

- [x] Imports resolved for changed files
- [x] Type definitions included in context
- [x] Related tests identified
- [x] Context size respects token limits

---

### F-009: RAG-Enhanced Reviews

| Attribute | Value |
|-----------|-------|
| **ID** | F-009 |
| **Priority** | 🟡 P2 |
| **Effort** | High (7-10 days) |
| **Status** | ✅ Complete |
| **Shipped** | v5.0.0 (Feb 2026) |
| **Dependencies** | F-008 (context system) |

#### Description

Implement Retrieval-Augmented Generation to pull relevant code examples, documentation, and past decisions into the review context.

#### RAG Sources

1. **Codebase Index** - Semantic search over project files
2. **Documentation** - README, ADRs, wiki content
3. **Past Reviews** - Historical review findings
4. **External Docs** - Framework/library documentation

#### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Embeddings │     │   Vector    │     │   Retrieval │
│   Service   │────▶│    Store    │────▶│    Query    │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       │         ┌─────────────────┐          │
       └────────▶│  Code Indexer   │◀─────────┘
                 └─────────────────┘
```

#### Configuration

```json
{
  "ollama-code-review.rag": {
    "enabled": false,
    "indexOnStartup": false,
    "embeddingModel": "nomic-embed-text",
    "vectorStore": "local",
    "maxResults": 5
  }
}
```

#### Implementation Notes

1. Use Ollama's `/api/embeddings` endpoint for local embedding generation
2. JSON file-based vector store in globalStorage (no native SQLite required)
3. TF-IDF fallback when embedding model is unavailable
4. Index on-demand via `indexCodebase` command or background startup
5. Cosine similarity search for retrieval; changed files excluded from results

#### Files Created

- `src/rag/types.ts` — RagConfig, CodeChunk, VectorStore, RetrievalResult interfaces
- `src/rag/config.ts` — `getRagConfig()` VS Code settings reader
- `src/rag/embeddings.ts` — Ollama embedding generation + TF-IDF fallback + cosine similarity
- `src/rag/vectorStore.ts` — `JsonVectorStore` class (JSON persistence, no native deps)
- `src/rag/indexer.ts` — `indexWorkspace()`, `indexFile()`, `chunkText()`
- `src/rag/retriever.ts` — `getRagContext()`, `buildRagContextSection()`
- `src/rag/index.ts` — Barrel exports

#### Integration

- Two new commands: `ollama-code-review.indexCodebase`, `ollama-code-review.clearRagIndex`
- RAG context injected after F-012 knowledge base context in `getOllamaReview()`
- New `ollama-code-review.rag.*` settings with 9 configurable properties

#### Acceptance Criteria

- [x] Codebase can be indexed via command
- [x] Similar code found for context using cosine similarity
- [x] Works with local Ollama embeddings (nomic-embed-text)
- [x] TF-IDF fallback when Ollama embedding model unavailable
- [x] Index persists to disk in globalStorage
- [x] RAG context shown in review prompt with similarity scores
- [x] Non-fatal — reviews proceed without context if index is empty

---

## Phase 4: Enterprise Features (v4.0)

### F-010: CI/CD Integration

| Attribute | Value |
|-----------|-------|
| **ID** | F-010 |
| **Priority** | 🟢 P3 |
| **Effort** | High (5-7 days) |
| **Status** | ✅ Complete |
| **Shipped** | v5.0.0 (Feb 2026) |
| **Dependencies** | F-004 (GitHub integration) |

#### Description

Run code reviews automatically in CI/CD pipelines. Post results to PRs and optionally block merges based on severity.

#### Components

1. **CLI Tool** - `ollama-review` command for CI
2. **GitHub Action** - Pre-built action for easy setup
3. **GitLab CI Template** - YAML template
4. **Webhook Handler** - Receive PR events

#### GitHub Action Example

```yaml
name: Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: glorynguyen/ollama-code-review-action@v1
        with:
          model: kimi-k2.5:cloud
          profile: security
          fail-on-severity: critical
          post-comments: true
```

#### Implementation Notes

1. Standalone `@ollama-code-review/cli` Node.js package (no VS Code dependency)
2. Supports all 7 AI providers: ollama, claude, gemini, mistral, glm, minimax, openai-compatible
3. GitHub Actions and GitLab CI workflow templates provided
4. All config settable via env vars for secret management

#### Files Created

- `packages/cli/package.json` — CLI package manifest
- `packages/cli/tsconfig.json` — TypeScript config for the CLI
- `packages/cli/src/index.ts` — CLI entry point with Commander.js argument parsing
- `packages/cli/src/config.ts` — Config builder from args + env vars; review profile prompts
- `packages/cli/src/review.ts` — `buildPrompt()` + `callAIProvider()` for all 7 providers
- `packages/cli/src/output.ts` — `parseSeverityCounts()`, `shouldFail()`, `formatOutput()` (text/json/markdown)
- `packages/cli/src/github.ts` — GitHub PR comment posting; PR context from env (GitHub Actions)
- `ci-templates/github-actions.yml` — Production-ready GitHub Actions workflow template
- `ci-templates/gitlab-ci.yml` — GitLab CI YAML template
- `ci-templates/README.md` — CI/CD integration guide

#### Acceptance Criteria

- [x] CLI runs reviews headlessly (no VS Code required)
- [x] Supports diff from file, stdin pipe, `--diff-base`, and `git diff HEAD`
- [x] GitHub Actions workflow template provided with PR comment posting
- [x] GitLab CI template provided
- [x] Results posted to GitHub PR via `--post-to-github` flag
- [x] Exits with code 1 when `--fail-on-severity` threshold is met
- [x] Output formats: `text`, `json`, `markdown`
- [x] All settings available as environment variables for CI secret management

---

### F-011: Review History & Analytics

| Attribute | Value |
|-----------|-------|
| **ID** | F-011 |
| **Priority** | 🟢 P3 |
| **Effort** | Medium (4-5 days) |
| **Status** | ✅ Complete |
| **Shipped** | v4.3.0 (Feb 2026) |
| **Dependencies** | F-016 (scoring system) |

#### Description

Track review history over time to identify trends, recurring issues, and improvement opportunities.

#### Implementation

- **Module:** `src/analytics/` — `tracker.ts`, `dashboard.ts`, `index.ts`
- **Storage:** JSON file at `{globalStorage}/review-scores.json` (up to 500 entries, no native deps)
- **Category extraction:** Keyword scanning for security, performance, bugs, style, maintainability, accessibility, documentation
- **Dashboard:** Chart.js CDN — score trend line chart, severity doughnut, category bar chart, review type breakdown, model usage, most reviewed files, weekly activity table
- **Export:** CSV and JSON export buttons
- **Enhanced fields:** `durationMs`, `reviewType`, `filesReviewed`, `categories`
- **Command:** `ollama-code-review.showAnalyticsDashboard`

#### Acceptance Criteria

- [x] Reviews tracked automatically
- [x] Dashboard shows key metrics
- [x] Data exportable (CSV and JSON)
- [x] No data sent externally

---

### F-012: Team Knowledge Base

| Attribute | Value |
|-----------|-------|
| **ID** | F-012 |
| **Priority** | 🟢 P3 |
| **Effort** | High (7-10 days) |
| **Status** | ✅ Complete |
| **Shipped** | v4.4.0 (Feb 2026) |
| **Dependencies** | None |

#### Description

Build a shared knowledge base of team decisions, patterns, and conventions that the AI can reference during reviews.

#### Implementation

- **Module:** `src/knowledge/` — `loader.ts`, `matcher.ts`, `types.ts`, `index.ts`
- **Config file:** `.ollama-review-knowledge.yaml` at workspace root (checked into Git)
- **Entry types:** Decisions (ADRs with id/title/decision/tags), Patterns (with examples), Rules (plain strings always injected)
- **Matching:** Keyword-based relevance scoring against diff content
- **Configuration:** `knowledgeBase.enabled`, `knowledgeBase.maxEntries` (1-50)
- **File watcher:** Auto-reloads on create/change/delete
- **Command:** `ollama-code-review.reloadKnowledgeBase`
- **Integration:** Injected into `getOllamaReview()` and `getOllamaFileReview()` prompts; non-fatal on failure

#### Acceptance Criteria

- [x] Knowledge file parsed and loaded
- [x] AI references relevant knowledge
- [x] Knowledge shared via Git (YAML file checked into repo)
- [x] File watcher auto-reloads on changes

---

## Appendix

### Feature ID Reference

| ID | Feature | Phase | Status | Shipped |
|----|---------|-------|--------|---------|
| S-001 | Multi-Provider Cloud Support | — | ✅ Complete | v1.10–v1.16 |
| S-002 | Agent Skills System | — | ✅ Complete | v1.18–v1.20 |
| S-003 | Performance Metrics | — | ✅ Complete | v1.15 |
| S-004 | Interactive Chat | — | ✅ Complete | v1.7 |
| S-005 | HF Model Picker | — | ✅ Complete | v1.15 |
| F-001 | Review Profiles | 1 | ✅ Complete | v3.1 |
| F-002 | Smart Diff Filtering | 1 | ✅ Complete | v1.x |
| F-003 | Export Options | 1 | ✅ Complete | v3.1 |
| F-004 | GitHub PR Integration | 2 | ✅ Complete | v3.3 |
| F-005 | Inline Code Actions | 2 | ✅ Complete | v1.18 |
| F-006 | Customizable Prompts | 2 | ✅ Complete | v2.1–v3.4 |
| F-007 | Agentic Multi-Step Reviews | 3 | ✅ Complete | v4.2 |
| F-008 | Multi-File Contextual Analysis | 3 | ✅ Complete | v4.0 |
| F-009 | RAG-Enhanced Reviews | 3 | ✅ Complete | v5.0 |
| F-010 | CI/CD Integration | 4 | ✅ Complete | v5.0 |
| F-011 | Review History & Analytics | 4 | ✅ Complete | v4.3 |
| F-012 | Team Knowledge Base | 4 | ✅ Complete | v4.4 |
| F-013 | OpenAI-Compatible Provider | 5 | ✅ Complete | v3.5 |
| F-014 | Pre-Commit Guard | 5 | ✅ Complete | v3.6 |
| F-015 | GitLab & Bitbucket Integration | 5 | ✅ Complete | v4.5 |
| F-016 | Review Quality Scoring & Trends | 5 | ✅ Complete | v4.1 |
| F-017 | Compliance Review Profiles | 5 | ✅ Complete | v4.0 |
| F-018 | Notification Integrations | 5 | ✅ Complete | v4.1 |
| F-019 | Batch / Legacy Code Review | 5 | ✅ Complete | v4.1 |
| F-020 | Architecture Diagram Generation | 5 | ✅ Complete | v4.2 |
| F-021 | Sidebar Chat Panel | 6 | ✅ Complete | main (2026-02-21) |
| F-022 | Streaming Responses | 6 | ✅ Complete | v6.0 |
| F-023 | @-Context Mentions in Chat | 6 | ✅ Complete | main (2026-02-22) |
| F-024 | Inline Edit Mode | 6 | 📋 Planned | — |
| F-025 | Provider Abstraction Layer | 6 | 📋 Planned | — |
| F-026 | Rules Directory | 6 | ✅ Complete | v6.0 |
| F-027 | extension.ts Decomposition | 6 | ✅ Complete | main (2026-02-21) |

### Effort Estimation Guide

| Effort | Days | Description |
|--------|------|-------------|
| Low | 1-2 | Single file, clear implementation |
| Medium | 3-5 | Multiple files, some complexity |
| High | 5-10 | New subsystem, significant complexity |

### Version Mapping (Revised)

**Actual shipping history (v1.x → v3.0.0):**

| Version | Features Shipped | Date |
|---------|-----------------|------|
| v1.7.0 | S-004: Interactive Chat | Jan 2026 |
| v1.10–v1.16 | S-001: Multi-Provider Cloud Support | Jan 2026 |
| v1.15.0 | S-003: Performance Metrics, S-005: HF Model Picker | Jan 2026 |
| v1.18.0 | F-005: Inline Code Actions, S-002: Agent Skills | Jan 2026 |
| v2.1.0 | F-006: Customizable Prompts (partial) | Feb 2026 |
| v3.0.0 | S-001: MiniMax provider added | Feb 2026 |

**Remaining roadmap (revised targets):**

| Version | Features | Target |
|---------|----------|--------|
| v3.1.0 | F-001 (Review Profiles), F-003 (Export Options) | Q1 2026 ✅ |
| v3.3–3.6 | F-004 (GitHub PR), F-006 (.yaml config), F-013 (OpenAI-compat), F-014 (Pre-Commit Guard) | Q1 2026 ✅ |
| v4.0–4.5 | F-007 (Agentic), F-008 (Context), F-011 (Analytics), F-012 (Knowledge), F-015 (GitLab/BB), F-016–F-020 | Q1 2026 ✅ |
| v5.0.0 | F-009 (RAG), F-010 (CI/CD) | Q1 2026 ✅ |
| v6.0.0 | F-021–F-027 (AI Assistant Evolution) | 2026 |

---

## Phase 5: Developer Experience & Ecosystem (v6.0)

> **Target:** Q1–Q2 2027
> **Theme:** Broaden provider support, deepen Git workflow integration, and improve team collaboration

---

### F-013: OpenAI-Compatible Provider Support

**Status:** ✅ Complete
**Shipped:** v3.5.0 (Feb 2026)
**Priority:** 🟠 P1 — High Impact, Low Effort
**Effort:** Low (1–2 days)

#### Overview

Add a generic `openai-compatible` provider that talks to any server exposing an OpenAI `/v1/chat/completions` endpoint. This covers LM Studio, LocalAI, vLLM, Groq, Together AI, Anyscale, and OpenRouter without requiring individual integrations.

#### User Problem

Users running LM Studio or vLLM for local inference, or using aggregators like OpenRouter, have no way to use the extension without an Ollama-specific API. A generic OpenAI-compatible provider eliminates that gap with minimal implementation cost.

#### Configuration

```json
"ollama-code-review.openaiCompatible.endpoint": "http://localhost:1234/v1",
"ollama-code-review.openaiCompatible.apiKey": "",
"ollama-code-review.openaiCompatible.model": "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF"
```

#### Implementation Notes

- Add `isOpenAICompatibleModel()` detection helper
- Add `callOpenAICompatibleAPI()` that calls `/v1/chat/completions` with the standard `messages` schema
- Model picker: add `openai-compatible` option, prompts for endpoint + model on first use
- Reuse `PerformanceMetrics` for input/output token counting from the `usage` field

#### Implementation Details

- `isOpenAICompatibleModel()` detection function in `src/extension.ts`
- `callOpenAICompatibleAPI()` calls `/chat/completions` with the standard messages schema
- `showOpenAICompatiblePicker()` — quickpick with server presets (LM Studio, LocalAI, vLLM, Groq, OpenRouter, Together AI) + custom endpoint input
- Settings: `openaiCompatible.endpoint`, `openaiCompatible.apiKey`, `openaiCompatible.model`
- Performance metrics: `openaiCompatibleInputTokens`, `openaiCompatibleOutputTokens` from `usage` field
- Chat follow-up supported in `src/reviewProvider.ts`
- All provider routes updated: `getOllamaReview()`, `getOllamaCommitMessage()`, `getOllamaSuggestion()`, `callAIProvider()`
- `handleError()` updated to detect OpenAI-compatible URL patterns

#### Acceptance Criteria

- [x] Works with LM Studio default endpoint out of the box
- [x] API key field optional (empty = no `Authorization` header)
- [x] Token counts displayed in System Info panel
- [x] Error message guides user to set endpoint if connection refused

---

### F-014: Pre-Commit Guard

**Status:** ✅ Complete
**Shipped:** v3.6.0 (Feb 2026)
**Priority:** 🟠 P1 — High Impact, Medium Effort
**Effort:** Medium (3–4 days)

#### Overview

Run a fast AI review automatically when the user triggers `git commit` from VS Code's Source Control panel. If the review finds issues above a configurable severity threshold, block the commit and show findings inline.

#### Implementation

- **Module:** `src/preCommitGuard.ts`
- **Hook management:** Install/uninstall `.git/hooks/pre-commit` (refuses to overwrite non-Ollama hooks)
- **Bypass mechanism:** Temporary `.git/.ollama-review-bypass` file for post-review commits
- **Severity assessment:** Uses `commentMapper.ts` to parse findings against threshold
- **Commands:** `togglePreCommitGuard` (status bar shield icon), `reviewAndCommit`
- **Settings:** `preCommitGuard.severityThreshold` (critical/high/medium/low), `preCommitGuard.timeout` (10-300s)
- **Status bar:** Shield icon shows `Guard ON` / `Guard OFF`, click to toggle

#### Acceptance Criteria

- [x] Opt-in only — disabled by default
- [x] Hook written/removed cleanly on setting toggle
- [x] Findings shown with severity badges; user can Commit Anyway, View Review, or Cancel
- [x] Timeout respected; commit proceeds if model unreachable
- [x] Works across all supported providers

---

### F-015: GitLab & Bitbucket PR Integration

**Status:** ✅ Complete
**Shipped:** v4.5.0 (Feb 2026)
**Priority:** 🟡 P2 — High Impact, High Effort
**Effort:** High (5–8 days)

#### Overview

Extends the GitHub PR Integration (F-004) to support GitLab Merge Requests and Bitbucket Pull Requests. Users on GitLab/Bitbucket can fetch MR/PR diffs, run AI reviews, and post results as comments.

#### Implementation

- `src/gitlab/auth.ts` — Multi-strategy auth: `glab` CLI → stored token; supports self-hosted via `gitlab.baseUrl`
- `src/gitlab/mrReview.ts` — MR fetching, diff retrieval via GitLab REST API v4, comment posting, open MR listing
- `src/bitbucket/auth.ts` — App Password auth with HTTP Basic Auth
- `src/bitbucket/prReview.ts` — PR fetching, diff retrieval via Bitbucket Cloud API 2.0, comment posting, open PR listing
- Platform auto-detection from `remote.origin.url` (checks for "gitlab" or "bitbucket" patterns)
- Uses existing Axios dependency for all API calls (no new packages required)

#### Configuration

```json
"ollama-code-review.gitlab.token": "",
"ollama-code-review.gitlab.baseUrl": "https://gitlab.com",
"ollama-code-review.bitbucket.username": "",
"ollama-code-review.bitbucket.appPassword": ""
```

#### Commands

| Command | Description |
|---------|-------------|
| `ollama-code-review.reviewGitLabMR` | Fetch and review a GitLab MR by URL or `!123` |
| `ollama-code-review.postReviewToMR` | Post review as a MR note |
| `ollama-code-review.reviewBitbucketPR` | Fetch and review a Bitbucket PR by URL |
| `ollama-code-review.postReviewToBitbucketPR` | Post review as a Bitbucket PR comment |

#### Acceptance Criteria

- [x] `git remote` URL auto-detects GitLab / Bitbucket
- [x] GitLab MR diff fetched and reviewed correctly
- [x] Bitbucket PR diff fetched and reviewed correctly
- [x] Review posted as comment with correct formatting for each platform
- [x] Auth errors surface clear guidance for obtaining tokens

---

### F-016: Review Quality Scoring & Trends

**Status:** ✅ Complete
**Shipped:** v4.1.0 (Feb 2026)
**Priority:** 🟡 P2 — High Impact, Medium Effort
**Effort:** Medium (3–5 days)

#### Overview

Assign a numeric quality score (0–100) to every review and persist scores in a lightweight local SQLite store (see ADR-003). Display a trend sparkline in the status bar and a history chart in a dedicated webview panel.

#### User Problem

Developers have no quantitative signal of whether code quality is improving or degrading across commits. Scores and trends make progress visible and motivating.

#### Scoring Algorithm (AI-assisted)

The review prompt asks the model to output a structured JSON block alongside prose:

```json
{
  "score": 84,
  "breakdown": {
    "correctness": 90,
    "security": 80,
    "maintainability": 82,
    "performance": 85
  }
}
```

The extension parses this block; if missing, falls back to a heuristic based on finding severity counts.

#### Storage Schema

```sql
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  timestamp TEXT,
  repo TEXT,
  commit TEXT,
  branch TEXT,
  score INTEGER,
  correctness INTEGER,
  security INTEGER,
  maintainability INTEGER,
  performance INTEGER,
  model TEXT,
  profile TEXT
);
```

#### UI

- Status bar item shows last score (e.g. `⭐ 84`) with color coding (green ≥ 80, yellow ≥ 60, red < 60)
- New command `ollama-code-review.showReviewHistory` opens a webview with a chart (Chart.js)
- Chart shows score trend over last 30 reviews, filterable by repo/branch/profile

#### Acceptance Criteria

- [x] Score extracted from AI response or computed by heuristic
- [x] Score stored locally per review
- [x] Status bar updated after every review
- [x] Trend chart renders correctly for ≥ 2 reviews
- [x] Scores survive VS Code restart

---

### F-017: Compliance Review Profiles

**Status:** ✅ Complete
**Shipped:** v4.0.0 (Feb 2026)
**Priority:** 🟡 P2 — High Impact, Low Effort
**Effort:** Low (1–2 days)

#### Overview

Add a set of pre-built review profiles focused on regulatory and security compliance frameworks. These extend the existing profiles system (F-001) and are selectable from the profile picker.

#### Compliance Profiles

| Profile ID | Framework | Focus |
|------------|-----------|-------|
| `owasp-top10` | OWASP Top 10 | Injection, broken auth, XSS, IDOR, misconfig, etc. |
| `pci-dss` | PCI-DSS v4 | Cardholder data handling, encryption, access control |
| `gdpr` | GDPR / CCPA | PII handling, data minimization, consent flows |
| `hipaa` | HIPAA | PHI protection, audit logging, access controls |
| `soc2` | SOC 2 Type II | Availability, confidentiality, change management |
| `nist-csf` | NIST CSF 2.0 | Identify, protect, detect, respond, recover |

#### Implementation Notes

- Compliance profiles added to `src/profiles.ts` alongside existing built-in presets
- Each profile includes a `complianceContext` string injected into the prompt before the diff
- Profile picker shows a `Compliance` group separator
- Selected profile stored like any other — no new settings required

#### Example Profile Definition

```typescript
{
  id: 'owasp-top10',
  name: 'OWASP Top 10',
  group: 'Compliance',
  description: 'Review against OWASP Top 10 web application security risks',
  focusAreas: ['injection', 'broken-auth', 'xss', 'insecure-deserialization', 'security-misconfiguration'],
  severity: 'critical',
  complianceContext: `You are auditing code against the OWASP Top 10 (2021). For each finding cite the relevant OWASP category (e.g. A03:2021 – Injection).`
}
```

#### Acceptance Criteria

- [x] All 6 compliance profiles appear in profile picker under a `Compliance` group
- [x] OWASP profile finds a SQL injection in a test diff
- [x] Profile-specific context is injected into the prompt
- [x] Profiles persist across sessions via existing profile storage

---

### F-018: Notification Integrations (Slack / Teams / Discord)

**Status:** ✅ Complete
**Shipped:** v4.1.0 (Feb 2026)
**Priority:** 🟢 P3 — Medium Impact, Low Effort
**Effort:** Low (1–2 days)

#### Overview

Post review summaries to Slack, Microsoft Teams, or Discord via incoming webhooks. Useful for teams that want shared visibility of code quality reviews without leaving their chat tool.

#### Configuration

```json
"ollama-code-review.notifications.slack.webhookUrl": "",
"ollama-code-review.notifications.teams.webhookUrl": "",
"ollama-code-review.notifications.discord.webhookUrl": "",
"ollama-code-review.notifications.triggerOn": ["critical", "high"]
```

`triggerOn`: only send notification when the review contains findings at or above these severities. Empty array = always send.

#### Payload Examples

**Slack (Block Kit):**
```json
{
  "text": "Code Review — `feat/login` — Score: 84/100",
  "blocks": [
    { "type": "section", "text": { "type": "mrkdwn", "text": "⚠️ *2 High* findings in `src/auth.ts`" } }
  ]
}
```

**Microsoft Teams (Adaptive Card):** Standard Adaptive Card v1.4 schema.

**Discord:** Simple `content` + `embeds` payload.

#### Implementation Notes

- New `src/notifications/` module with `slack.ts`, `teams.ts`, `discord.ts`
- Called at the end of `runReview()` if any webhook URL is configured
- Uses Axios (already a dependency) — no new packages required
- Notification includes: repo name, branch, score (if F-016 enabled), top N findings, link to commit

#### Acceptance Criteria

- [x] Slack message delivered when webhook URL configured
- [x] Teams card delivered when webhook URL configured
- [x] Discord message delivered when webhook URL configured
- [x] `triggerOn` filter respected — no spurious notifications for clean reviews
- [x] Notification failures logged but do not interrupt review flow

---

### F-019: Batch / Legacy Code Review (No Git Diff Required)

**Status:** ✅ Complete
**Shipped:** v4.1.0 (Feb 2026)
**Priority:** 🟡 P2 — High Impact, Low Effort
**Effort:** Low (2–3 days)

#### Overview

Review arbitrary files, folders, or selections without needing a Git diff. Aimed at legacy codebases, third-party code, or files not tracked by Git.

#### User Problem

All existing review commands require Git-tracked staged changes or commits. Developers auditing inherited code, reviewing vendor code, or working outside Git have no path to AI review today.

#### New Commands

| Command | Entry Point | Description |
|---------|-------------|-------------|
| `ollama-code-review.reviewFile` | Explorer context menu | Review the currently open file in full |
| `ollama-code-review.reviewFolder` | Explorer context menu | Review all files in a selected folder |
| `ollama-code-review.reviewSelection` | Editor context menu | Review the selected text only |

#### Configuration

```json
"ollama-code-review.batch.maxFileSizeKb": 100,
"ollama-code-review.batch.includeGlob": "**/*.{ts,js,py,go,java,php,rb}",
"ollama-code-review.batch.excludeGlob": "**/node_modules/**"
```

#### Implementation Notes

- For file review: read file content directly via `vscode.workspace.fs.readFile`
- For folder review: glob matching with `batch.includeGlob`, concatenate files with `--- filename ---` separators up to a token budget
- For selection review: pass `editor.document.getText(editor.selection)` as the code block
- Use the same `runReview()` / `reviewProvider` pipeline — no new UI required
- Prefix the prompt with `[File Review — no diff context]` so the model adjusts expectations

#### Acceptance Criteria

- [x] Single file reviewed end-to-end without Git
- [x] Folder review respects include/exclude globs
- [x] Selection review works from right-click context menu
- [x] Token budget respected — large folders truncated to budget
- [x] Review panel shows filename(s) reviewed in the header

---

### F-020: Architecture Diagram Generation (Mermaid)

**Status:** ✅ Complete
**Shipped:** v4.2.0 (Feb 2026)
**Priority:** 🟢 P3 — Medium Impact, High Effort
**Effort:** High (5–7 days)

#### Overview

Generate a Mermaid.js diagram from a code diff or set of files, showing how changed components relate to one another. The diagram is embedded in the review output or can be copied independently.

#### Implementation

- **Module:** `src/diagramGenerator.ts`
- **Diagram types:** classDiagram, flowchart TD, sequenceDiagram, graph TD (AI selects best type)
- **Rendering:** Mermaid.js v10 CDN in review panel alongside highlight.js and marked.js
- **UI:** "Copy Source" button extracts raw Mermaid from `data-mermaid-source` attribute
- **Validation:** Basic syntax validation; invalid syntax shows error with raw source fallback
- **Command:** `ollama-code-review.generateDiagram`

#### Acceptance Criteria

- [x] Diagram generated for a TypeScript class diff without manual type selection
- [x] Mermaid renders correctly in the review panel
- [x] Copy Source button functional
- [x] Graceful fallback message if model output is not valid Mermaid syntax
- [x] Diagram generation is a separate optional call — does not slow down the main review

---

## Phase 6: AI Assistant Evolution (v6.0)

> **Target:** 2026
> **Theme:** Evolve from review tool to AI coding assistant while preserving deep review specialization. Inspired by Continue.dev's interaction model but focused on code quality.

---

### F-021: Sidebar Chat Panel

| Attribute | Value |
|-----------|-------|
| **ID** | F-021 |
| **Priority** | 🟠 P1 |
| **Effort** | High (7-10 days) |
| **Status** | 📋 Planned |
| **Dependencies** | F-025 (provider abstraction), F-022 (streaming) |

#### Overview

Move the interactive chat from the review webview panel to a persistent sidebar `WebviewViewProvider`. This transforms the extension from a tool-you-invoke into a persistent AI assistant that's always available. The sidebar chat maintains conversation history, supports model switching, and renders streaming markdown.

#### User Problem

The current chat is embedded in the review panel — it's only available after running a review, and closing the panel loses the conversation. Users want a persistent AI assistant for ad-hoc questions about their codebase, not just post-review follow-ups.

#### Architecture

```
┌──────────────────────────────────┐
│         VS Code Sidebar          │
├──────────────────────────────────┤
│  Model Selector (dropdown)       │
│  ─────────────────────────────── │
│  Conversation History            │
│  ┌─────────────────────────┐    │
│  │ User: Explain auth flow │    │
│  │ AI: The auth flow...    │    │
│  │ User: @file src/auth.ts │    │
│  │ AI: Looking at auth.ts..│    │
│  └─────────────────────────┘    │
│  ─────────────────────────────── │
│  [ Message input with @-mention ]│
│  [Send] [New Chat] [Clear]      │
└──────────────────────────────────┘
```

#### Implementation Notes

1. Register a `WebviewViewProvider` for the sidebar (not `WebviewPanel`)
2. React or vanilla HTML/JS for the chat UI (start with vanilla to avoid build complexity)
3. Conversation history persisted in `globalState`
4. Model selector mirrors the existing status bar model picker
5. Integrate with existing `_getFollowUpResponse()` logic from `reviewProvider.ts`
6. Support injecting review context: "Discuss this review" button in review panel opens sidebar with context

#### Files to Create

- `src/chat/sidebarProvider.ts` — `WebviewViewProvider` implementation
- `src/chat/conversationManager.ts` — Conversation history management and persistence
- `src/chat/types.ts` — Chat-specific types

#### Files to Modify

- `package.json` — Register `viewsContainers`, `views`, sidebar contribution
- `src/extension.ts` — Register sidebar provider in `activate()`

#### Acceptance Criteria

- [ ] Sidebar panel visible in VS Code activity bar
- [ ] Multi-turn conversation with streaming responses
- [ ] Model switching within sidebar
- [ ] Conversation history persists across VS Code restarts
- [ ] "Discuss this review" integration with review panel

---

### F-022: Streaming Responses

| Attribute | Value |
|-----------|-------|
| **ID** | F-022 |
| **Priority** | 🟠 P1 |
| **Effort** | Medium (3-5 days) |
| **Status** | ✅ Complete |
| **Shipped** | v6.0.0 (Feb 2026) |
| **Dependencies** | None (implemented without F-025 via dedicated streaming functions) |

#### Overview

Add Server-Sent Events (SSE) / streaming support to all 8 AI provider callers. Tokens are streamed to the UI incrementally instead of waiting for the full response. This dramatically improves perceived responsiveness and enables mid-generation cancellation.

#### User Problem

Current reviews show a loading spinner for 10-60 seconds before any content appears. Streaming makes the AI feel responsive from the first token and lets users cancel early if the output is going in the wrong direction.

#### Provider Streaming Support

| Provider | Streaming Mechanism | Implementation |
|----------|-------------------|----------------|
| Ollama | Native `stream: true` in `/api/generate` | Newline-delimited JSON |
| Claude | `stream: true` in Messages API | SSE (`event: content_block_delta`) |
| GLM | `stream: true` (OpenAI-compatible) | SSE (`data: {...}`) |
| Hugging Face | `stream: true` (OpenAI-compatible) | SSE |
| Gemini | `streamGenerateContent` endpoint | SSE |
| Mistral | `stream: true` (OpenAI-compatible) | SSE |
| MiniMax | `stream: true` | SSE |
| OpenAI-Compatible | `stream: true` | SSE (`data: {...}`) |

#### Implementation Notes

1. Each provider's `callXxxAPI()` returns an `AsyncGenerator<string>` when streaming is requested
2. A `StreamRenderer` class in the webview incrementally parses markdown and updates the DOM
3. Cancellation via `AbortController` — abort the HTTP request mid-stream
4. Performance metrics captured from the final SSE message or accumulated during streaming
5. Non-streaming mode preserved as fallback for providers that fail streaming

#### Files to Create

- `src/streaming/streamParser.ts` — Parse SSE streams from different providers
- `src/streaming/types.ts` — `StreamChunk`, `StreamOptions` interfaces

#### Files to Modify

- `src/extension.ts` — Update all `callXxxAPI()` functions to support `stream: true`
- `src/reviewProvider.ts` — Add `StreamRenderer` for incremental DOM updates
- `src/chat/sidebarProvider.ts` — Stream into sidebar chat

#### Acceptance Criteria

- [x] First token visible within 500ms of request start (for fast providers)
- [x] Full response identical to non-streaming mode
- [ ] Cancel button stops generation and HTTP request (planned for F-024)
- [x] Performance metrics still captured accurately
- [x] Graceful fallback to non-streaming if SSE parsing fails

---

### F-023: @-Context Mentions in Chat

| Attribute | Value |
|-----------|-------|
| **ID** | F-023 |
| **Priority** | 🟡 P2 |
| **Effort** | Medium (4-5 days) |
| **Status** | ✅ Complete |
| **Dependencies** | F-021 (sidebar chat), F-008 (context gathering), F-009 (RAG) |

#### Overview

Add `@`-mention context providers to the sidebar chat. Users type `@` to see a dropdown of available context sources — `@file`, `@diff`, `@review`, `@selection`, `@knowledge` — and the referenced content is injected into the AI prompt.

#### Context Providers

| Provider | Trigger | Description | Builds On |
|----------|---------|-------------|-----------|
| `@file` | `@file path/to/file.ts` | Include full file content in context | `vscode.workspace.fs` |
| `@diff` | `@diff` or `@diff staged` | Include current staged diff | Existing `runGitCommand()` |
| `@review` | `@review` | Include the most recent review output | `OllamaReviewPanel` |
| `@codebase` | `@codebase query terms` | Semantic search via RAG index | F-009 RAG retriever |
| `@selection` | `@selection` | Include current editor selection | `vscode.window.activeTextEditor` |
| `@knowledge` | `@knowledge` | Include relevant team knowledge entries | F-012 knowledge matcher |

#### Implementation Notes

1. `@`-keystroke in chat input triggers a QuickPick-style dropdown filtered by typing
2. Each provider implements a `ContextProvider` interface: `resolve(args: string): Promise<string>`
3. Resolved context is prepended to the user message in the system prompt
4. Context shown as a collapsible preview in the chat UI above the AI response
5. Token budget enforced: each `@` context limited to 8,000 chars

#### Files to Create

- `src/chat/contextProviders.ts` — Provider registry and resolution
- `src/chat/contextTypes.ts` — `ContextProvider` interface

#### Acceptance Criteria

- [ ] `@file` resolves workspace files with autocomplete
- [ ] `@diff` injects current staged changes
- [ ] `@codebase` returns semantically similar code chunks
- [ ] Context preview shown in chat UI
- [ ] Token budget respected — large contexts truncated

---

### F-024: Inline Edit Mode

| Attribute | Value |
|-----------|-------|
| **ID** | F-024 |
| **Priority** | 🟡 P2 |
| **Effort** | High (5-7 days) |
| **Status** | 📋 Planned |
| **Dependencies** | F-022 (streaming), F-025 (provider abstraction) |

#### Overview

Highlight code in the editor, describe the desired change in natural language, and the AI applies the edit with a streaming inline diff preview. Extends the existing Fix action (F-005) into a general-purpose inline editor.

#### User Problem

The current Fix action requires a diagnostic or specific issue. Users want to say "refactor this to use async/await" or "add error handling here" and have the AI apply the change in-place, not in a separate preview panel.

#### User Flow

```
1. User selects code in editor
2. Presses Ctrl+K (or via command palette / context menu)
3. Input box appears inline: "Describe the change..."
4. User types: "Convert to async/await with try-catch"
5. AI streams the replacement with diff highlighting
6. User accepts (Enter) or rejects (Escape)
```

#### Implementation Notes

1. Use `vscode.window.showInputBox` or inline input widget for change description
2. AI generates replacement code using the selected code + description as prompt
3. Streaming diff shown via `vscode.TextEditor.setDecorations()` with green/red highlighting
4. Accept applies the edit; reject restores original
5. Undo support via `vscode.workspace.applyEdit()` which integrates with VS Code's undo stack

#### Files to Create

- `src/inlineEdit/inlineEditProvider.ts` — Inline edit orchestration
- `src/inlineEdit/diffDecorator.ts` — Streaming diff decorations in editor

#### Files to Modify

- `src/extension.ts` — Register inline edit command
- `package.json` — Add command and keybinding

#### Acceptance Criteria

- [ ] Inline input box appears on Ctrl+K with selection
- [ ] AI-generated replacement streams with diff highlighting
- [ ] Accept applies changes to file
- [ ] Reject restores original code
- [ ] Works with all 8 AI providers

---

### F-025: Provider Abstraction Layer

| Attribute | Value |
|-----------|-------|
| **ID** | F-025 |
| **Priority** | 🔴 P0 |
| **Effort** | Medium (3-4 days) |
| **Status** | 📋 Planned |
| **Dependencies** | None |

#### Overview

Refactor the 8 provider pairs (`isXxxModel()` + `callXxxAPI()`) in `extension.ts` into a unified `ModelProvider` interface with a `ProviderRegistry`. This is the architectural prerequisite for streaming (F-022), sidebar chat (F-021), and inline edit (F-024).

#### User Problem

No direct user-facing change, but unblocks all Phase 6 features by providing a consistent interface for generate, chat, stream, and embed operations across all providers.

#### Architecture

```typescript
// src/providers/types.ts
interface ModelProvider {
  name: string;
  isMatch(model: string): boolean;
  isAvailable(): Promise<boolean>;
  generate(prompt: string, options: GenerateOptions): Promise<string>;
  stream(prompt: string, options: GenerateOptions): AsyncGenerator<string>;
  chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string>;
  embed?(text: string): Promise<number[]>;
  getMetrics(): PerformanceMetrics;
}

// src/providers/registry.ts
class ProviderRegistry {
  register(provider: ModelProvider): void;
  resolve(model: string): ModelProvider;
  listAvailable(): Promise<ModelProvider[]>;
}
```

#### Implementation Notes

1. Extract each `callXxxAPI()` + `isXxxModel()` into a class implementing `ModelProvider`
2. Create `src/providers/` directory with one file per provider
3. `ProviderRegistry` resolves model string to the correct provider
4. Existing `getOllamaReview()` routing logic replaced by `registry.resolve(model).generate()`
5. Streaming added as `stream()` method on each provider (see F-022)
6. Backward-compatible: all existing commands continue to work

#### Files to Create

- `src/providers/types.ts` — `ModelProvider`, `GenerateOptions`, `ChatOptions` interfaces
- `src/providers/registry.ts` — `ProviderRegistry` class
- `src/providers/ollama.ts` — Ollama provider
- `src/providers/claude.ts` — Claude/Anthropic provider
- `src/providers/glm.ts` — GLM/Z.AI provider
- `src/providers/huggingface.ts` — Hugging Face provider
- `src/providers/gemini.ts` — Gemini provider
- `src/providers/mistral.ts` — Mistral provider
- `src/providers/minimax.ts` — MiniMax provider
- `src/providers/openaiCompatible.ts` — OpenAI-compatible provider
- `src/providers/index.ts` — Barrel exports

#### Files to Modify

- `src/extension.ts` — Replace inline provider logic with `ProviderRegistry` calls

#### Acceptance Criteria

- [ ] All 8 providers implemented as `ModelProvider` classes
- [ ] `ProviderRegistry.resolve()` correctly routes all model strings
- [ ] All existing commands work identically after refactor
- [ ] `generate()` and `stream()` methods available on each provider
- [ ] Performance metrics captured per-provider as before

---

### F-026: Rules Directory

| Attribute | Value |
|-----------|-------|
| **ID** | F-026 |
| **Priority** | 🟢 P3 |
| **Effort** | Low (1-2 days) |
| **Status** | ✅ Complete |
| **Shipped** | v6.0.0 (Feb 2026) |
| **Dependencies** | F-012 (team knowledge base) |

#### Overview

Support a `.ollama-review/rules/` directory at the workspace root containing Markdown files that are always injected into review prompts. Simpler than the F-012 YAML knowledge base — just drop `.md` files into a folder and they're applied to every review.

#### User Problem

The F-012 knowledge base requires learning the YAML schema. Some teams just want to write plain-text rules ("Always use TypeScript strict mode", "Never use `any` type") without structured fields. A rules directory mirrors Continue.dev's `.continue/rules/` pattern.

#### Implementation Notes

1. On extension activation, glob `.ollama-review/rules/*.md` in workspace root
2. Concatenate all rule files into a single "Team Rules" section
3. Inject into review prompt after profile context, before the diff
4. File watcher auto-reloads on changes (mirrors F-006 watcher pattern)
5. Coexists with F-012 knowledge base — both are injected if both exist

#### Files to Create

- `src/rules/loader.ts` — Glob, read, concatenate, cache rules directory

#### Files to Modify

- `src/extension.ts` — Inject rules into review prompt, add file watcher

#### Acceptance Criteria

- [x] `.ollama-review/rules/*.md` files auto-loaded on activation
- [x] Rules injected into every review prompt
- [x] File watcher reloads on create/change/delete
- [x] Coexists with F-012 knowledge base without conflicts

---

### F-027: extension.ts Decomposition

| Attribute | Value |
|-----------|-------|
| **ID** | F-027 |
| **Priority** | 🔴 P0 |
| **Effort** | Medium (3-5 days) |
| **Status** | ✅ Complete |
| **Dependencies** | None |
| **Shipped** | main branch (2026-02-21) |

#### Overview

Split the monolithic `extension.ts` into focused modules. No new features — this structural refactor improves maintainability and startup loading characteristics.

#### User Problem

No direct user-facing change, but the monolithic `extension.ts` makes it difficult to add sidebar chat, streaming, inline edit, and provider abstraction without creating merge conflicts and cognitive overload.

#### Delivered Module Structure

```
src/
├── extension.ts              # thin wrapper: lazy-loads commands module
├── commands/
│   ├── index.ts              # activation logic + command registration + workflows
│   ├── providerClients.ts    # provider detection, API clients, streaming, metrics
│   ├── aiActions.ts          # explain/tests/fix/docs/suggestion helpers
│   └── uiHelpers.ts          # status bar, QuickPick, and shared UI utilities
```

#### Implementation Notes

1. Extracted command/runtime logic from `extension.ts` into `src/commands/*`.
2. `extension.ts` now delegates through lazy module loading.
3. Provider routing and metrics logic moved to `src/commands/providerClients.ts`.
4. Shared UI helpers and AI code-action helpers moved to `uiHelpers.ts` and `aiActions.ts`.
5. Behavior remains unchanged for end users (structural refactor only).

#### Acceptance Criteria

- [x] `extension.ts` reduced to a thin wrapper
- [x] Existing commands continue to work identically
- [x] No intentional behavior changes (structural refactor only)
- [x] Extracted modules have focused responsibilities
- [x] Build remains successful

---
