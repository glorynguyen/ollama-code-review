# Feature Specifications

> **Document Version:** 3.0.0
> **Last Updated:** 2026-02-18

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

- [ ] Lock files automatically excluded
- [ ] User can configure ignore patterns
- [ ] Summary shows "X files filtered"
- [ ] User can force-include filtered files

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
| **Status** | 📋 Planned |
| **Dependencies** | F-001 (for profile selection in PR context) |

#### Description

Integrate directly with GitHub Pull Requests to post review comments, suggest changes, and track review status.

#### Features

1. **Fetch PR Diff** - Review PRs by URL or number
2. **Post Comments** - Add review comments to PR
3. **Inline Suggestions** - GitHub suggestion blocks for fixes
4. **Review Summary** - Post summary comment with findings
5. **Status Check** - Optional GitHub check integration

#### User Flow

```
1. User runs "Review GitHub PR"
2. Enter PR URL or select from list
3. Extension fetches PR diff
4. AI generates review
5. User reviews findings
6. Click "Post to GitHub" → Comments added to PR
```

#### Configuration Schema

```json
{
  "ollama-code-review.github": {
    "type": "object",
    "properties": {
      "token": {
        "type": "string",
        "description": "GitHub Personal Access Token"
      },
      "autoPost": {
        "type": "boolean",
        "default": false,
        "description": "Automatically post reviews to PR"
      },
      "commentStyle": {
        "type": "string",
        "enum": ["inline", "summary", "both"],
        "default": "both"
      }
    }
  }
}
```

#### API Endpoints Required

- `GET /repos/{owner}/{repo}/pulls/{pull_number}` - PR metadata
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` - PR diff
- `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` - Post review
- `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` - Inline comments

#### Implementation Notes

1. Leverage existing `@octokit/rest` dependency
2. Add authentication flow (token or GitHub CLI)
3. Parse AI review output into structured comments
4. Map comments to specific file lines

#### Files to Modify

- `src/extension.ts` - Add PR review command
- New: `src/github/prReview.ts` - PR fetching and posting
- New: `src/github/commentMapper.ts` - Map review to line numbers
- `package.json` - Add commands and settings

#### Acceptance Criteria

- [ ] Can fetch PR by URL
- [ ] Review displays PR context
- [ ] Can post summary comment to PR
- [ ] Can post inline comments
- [ ] Handles authentication gracefully

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
| **Status** | ✅ Complete (partial — settings only, no `.yaml` file support) |
| **Shipped** | v2.1.0 (Feb 2026) |
| **Dependencies** | None |

#### Description

Users can customize the system prompts used for reviews and commit messages via VS Code settings with variable interpolation.

#### What Was Implemented

**Settings (in `package.json`):**
- `ollama-code-review.prompt.review` — Custom review prompt template (multiline text)
- `ollama-code-review.prompt.commitMessage` — Custom commit message prompt template

**Template variables:** `${code}`, `${frameworks}`, `${skills}`, `${diff}`, `${draftMessage}`

**Implementation:** `resolvePrompt(template, variables)` in `src/utils.ts` replaces `${variable}` placeholders. Agent skills are always appended if `${skills}` placeholder is missing from the template.

#### What Was NOT Implemented (remaining scope)

- `.ollama-review.yaml` config file loading (team sharing via repo)
- Config hierarchy: defaults → user → workspace → file
- Schema validation for config files
- `src/config/promptLoader.ts` module

#### Acceptance Criteria

- [x] User can override prompts in settings
- [ ] `.ollama-review.yaml` loaded if present *(not implemented)*
- [x] Variables interpolated correctly
- [ ] Invalid config shows helpful errors *(not applicable yet)*

---

## Phase 3: Intelligence Layer (v3.0)

### F-007: Agentic Multi-Step Reviews

| Attribute | Value |
|-----------|-------|
| **ID** | F-007 |
| **Priority** | 🟡 P2 |
| **Effort** | High (7-10 days) |
| **Status** | 📋 Planned |
| **Dependencies** | F-006 (customizable prompts) |

#### Description

Transform the single-pass review into a multi-step agentic workflow that gathers context, analyzes patterns, and produces more insightful reviews.

#### Agent Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENTIC REVIEW FLOW                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: ANALYZE DIFF                                        │
│  ├── Parse changed files                                     │
│  ├── Identify change types (new, modified, deleted)          │
│  └── Extract key changes                                     │
│           │                                                  │
│           ▼                                                  │
│  Step 2: GATHER CONTEXT                                      │
│  ├── Read imported files                                     │
│  ├── Find related tests                                      │
│  ├── Check type definitions                                  │
│  └── Load project conventions                                │
│           │                                                  │
│           ▼                                                  │
│  Step 3: PATTERN ANALYSIS                                    │
│  ├── Compare with codebase patterns                          │
│  ├── Check naming conventions                                │
│  └── Verify architectural consistency                        │
│           │                                                  │
│           ▼                                                  │
│  Step 4: DEEP REVIEW                                         │
│  ├── Security analysis                                       │
│  ├── Performance implications                                │
│  ├── Bug detection                                           │
│  └── Best practices                                          │
│           │                                                  │
│           ▼                                                  │
│  Step 5: SYNTHESIS                                           │
│  ├── Prioritize findings                                     │
│  ├── Generate actionable suggestions                         │
│  └── Self-critique and refine                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Configuration

```json
{
  "ollama-code-review.agentMode": {
    "enabled": true,
    "maxContextFiles": 10,
    "includeTests": true,
    "includeTypes": true,
    "selfCritique": true
  }
}
```

#### Implementation Notes

1. Create agent orchestrator in `src/agent/`
2. Each step is a separate function with clear I/O
3. Show progress in UI for each step
4. Allow cancellation between steps
5. Cache gathered context for follow-up questions

#### Files to Create

- `src/agent/orchestrator.ts` - Main agent loop
- `src/agent/steps/analyzeDiff.ts`
- `src/agent/steps/gatherContext.ts`
- `src/agent/steps/patternAnalysis.ts`
- `src/agent/steps/deepReview.ts`
- `src/agent/steps/synthesis.ts`

#### Acceptance Criteria

- [ ] Agent completes all steps for simple diffs
- [ ] Progress shown for each step
- [ ] Context gathering improves review quality
- [ ] Can be cancelled mid-process
- [ ] Fallback to simple review if agent fails

---

### F-008: Multi-File Contextual Analysis

| Attribute | Value |
|-----------|-------|
| **ID** | F-008 |
| **Priority** | 🟡 P2 |
| **Effort** | Medium (4-5 days) |
| **Status** | 📋 Planned |
| **Dependencies** | F-007 (uses context in agent flow) |

#### Description

Analyze related files beyond the diff to understand the full impact of changes. Identify imports, dependencies, and affected code paths.

#### Context Sources

| Source | Method | Priority |
|--------|--------|----------|
| Direct imports | Parse import statements | High |
| Type definitions | Find `.d.ts` or interface files | High |
| Related tests | Match `*.test.*`, `*.spec.*` | Medium |
| Parent classes | Trace inheritance | Medium |
| Consumers | Find files importing changed module | Low |

#### Implementation Notes

1. Build dependency graph from changed files
2. Use TypeScript compiler API for accurate parsing
3. Limit context to avoid token limits
4. Prioritize most relevant files

#### Files to Modify

- New: `src/context/dependencyGraph.ts`
- New: `src/context/fileResolver.ts`
- `src/agent/steps/gatherContext.ts` - Use new context system

#### Acceptance Criteria

- [ ] Imports resolved for changed files
- [ ] Type definitions included in context
- [ ] Related tests identified
- [ ] Context size respects token limits

---

### F-009: RAG-Enhanced Reviews

| Attribute | Value |
|-----------|-------|
| **ID** | F-009 |
| **Priority** | 🟡 P2 |
| **Effort** | High (7-10 days) |
| **Status** | 📋 Planned |
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

1. Use Ollama embedding models for local operation
2. Store vectors in SQLite with `better-sqlite3`
3. Index on-demand or background process
4. Include relevance scores in context

#### Files to Create

- `src/rag/indexer.ts` - Code indexing
- `src/rag/embeddings.ts` - Embedding generation
- `src/rag/vectorStore.ts` - Vector storage
- `src/rag/retriever.ts` - Similarity search

#### Acceptance Criteria

- [ ] Codebase can be indexed
- [ ] Similar code found for context
- [ ] Index updates incrementally
- [ ] Works with local Ollama embeddings

---

## Phase 4: Enterprise Features (v4.0)

### F-010: CI/CD Integration

| Attribute | Value |
|-----------|-------|
| **ID** | F-010 |
| **Priority** | 🟢 P3 |
| **Effort** | High (5-7 days) |
| **Status** | 📋 Planned |
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

1. Extract core review logic into separate package
2. Build CLI wrapper with Node.js
3. Publish GitHub Action to marketplace
4. Document self-hosted Ollama setup for CI

#### Files to Create

- `packages/cli/` - CLI tool
- `packages/action/` - GitHub Action
- `.github/workflows/action.yml` - Action definition

#### Acceptance Criteria

- [ ] CLI runs reviews headlessly
- [ ] GitHub Action works in workflows
- [ ] Results posted to PR
- [ ] Can fail pipeline on severity threshold

---

### F-011: Review History & Analytics

| Attribute | Value |
|-----------|-------|
| **ID** | F-011 |
| **Priority** | 🟢 P3 |
| **Effort** | Medium (4-5 days) |
| **Status** | 📋 Planned |
| **Dependencies** | None |

#### Description

Track review history over time to identify trends, recurring issues, and improvement opportunities.

#### Tracked Metrics

| Metric | Description |
|--------|-------------|
| Reviews count | Total reviews performed |
| Issues by severity | Critical/High/Medium/Low distribution |
| Issues by category | Security, Performance, Style, etc. |
| Resolution rate | Issues fixed after review |
| Time to review | Average review duration |
| Files reviewed | Most frequently reviewed files |

#### Data Storage

Store analytics locally in SQLite:

```sql
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  timestamp INTEGER,
  model TEXT,
  profile TEXT,
  files_count INTEGER,
  issues_count INTEGER,
  duration_ms INTEGER
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  review_id TEXT,
  severity TEXT,
  category TEXT,
  file_path TEXT,
  resolved BOOLEAN
);
```

#### UI Components

1. **Dashboard View** - Webview with charts
2. **Status Bar** - Quick stats badge
3. **Weekly Digest** - Notification summary

#### Implementation Notes

1. Use `better-sqlite3` for local storage
2. Charts with Chart.js or similar
3. Export data as CSV/JSON
4. Privacy: all data local by default

#### Files to Create

- `src/analytics/store.ts` - SQLite wrapper
- `src/analytics/tracker.ts` - Event tracking
- `src/analytics/dashboard.ts` - Webview panel
- New: `webview-ui/dashboard/` - Dashboard frontend

#### Acceptance Criteria

- [ ] Reviews tracked automatically
- [ ] Dashboard shows key metrics
- [ ] Data exportable
- [ ] No data sent externally

---

### F-012: Team Knowledge Base

| Attribute | Value |
|-----------|-------|
| **ID** | F-012 |
| **Priority** | 🟢 P3 |
| **Effort** | High (7-10 days) |
| **Status** | 📋 Planned |
| **Dependencies** | F-009 (RAG system), F-011 (analytics) |

#### Description

Build a shared knowledge base of team decisions, patterns, and conventions that the AI can reference during reviews.

#### Knowledge Types

| Type | Example | Storage |
|------|---------|---------|
| Architecture Decisions | "Use Redux for global state" | ADR files |
| Code Patterns | "Authentication middleware pattern" | Code snippets |
| Review Precedents | "We allow X because Y" | Past reviews |
| Team Rules | "Always use named exports" | Config file |

#### Integration Points

1. **Learning** - Mark review findings as "team decision"
2. **Reference** - AI cites knowledge base in reviews
3. **Sharing** - Sync via Git or shared storage
4. **Editing** - UI to manage knowledge entries

#### Configuration

```yaml
# .ollama-review-knowledge.yaml
decisions:
  - id: ADR-001
    title: Use Redux for state management
    context: Need consistent state across app
    decision: All global state in Redux
    date: 2024-01-15

patterns:
  - id: PAT-001
    name: API error handling
    description: Standard try/catch with toast notification
    example: |
      try {
        const data = await api.fetch();
      } catch (error) {
        toast.error(error.message);
        logger.error(error);
      }

rules:
  - Always use TypeScript strict mode
  - Prefer functional components
  - Tests required for business logic
```

#### Implementation Notes

1. Parse knowledge files on startup
2. Include relevant entries in review context
3. Allow marking review findings as new knowledge
4. Version knowledge with Git

#### Files to Create

- `src/knowledge/loader.ts` - Parse knowledge files
- `src/knowledge/matcher.ts` - Find relevant entries
- `src/knowledge/editor.ts` - UI for editing
- New: `webview-ui/knowledge/` - Knowledge manager UI

#### Acceptance Criteria

- [ ] Knowledge file parsed and loaded
- [ ] AI references relevant knowledge
- [ ] Can add new entries from reviews
- [ ] Knowledge shared via Git

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
| F-004 | GitHub PR Integration | 2 | 📋 Planned | — |
| F-005 | Inline Code Actions | 2 | ✅ Complete | v1.18 |
| F-006 | Customizable Prompts | 2 | ✅ Complete (partial) | v2.1 |
| F-007 | Agentic Multi-Step Reviews | 3 | 📋 Planned | — |
| F-008 | Multi-File Contextual Analysis | 3 | 📋 Planned | — |
| F-009 | RAG-Enhanced Reviews | 3 | 📋 Planned | — |
| F-010 | CI/CD Integration | 4 | 📋 Planned | — |
| F-011 | Review History & Analytics | 4 | 📋 Planned | — |
| F-012 | Team Knowledge Base | 4 | 📋 Planned | — |
| F-013 | OpenAI-Compatible Provider | 5 | ✅ Complete | v3.5 |
| F-014 | Pre-Commit Guard | 5 | 📋 Planned | — |
| F-015 | GitLab & Bitbucket Integration | 5 | 📋 Planned | — |
| F-016 | Review Quality Scoring & Trends | 5 | ✅ Complete | v4.1 |
| F-017 | Compliance Review Profiles | 5 | ✅ Complete | v4.0 |
| F-018 | Notification Integrations | 5 | ✅ Complete | v4.1 |
| F-019 | Batch / Legacy Code Review | 5 | ✅ Complete | v4.1 |
| F-020 | Architecture Diagram Generation | 5 | 📋 Planned | — |

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
| v3.5.0 | F-004 (GitHub PR Integration), F-006 remainder (.yaml config) | Q2 2026 |
| v4.0.0 | F-007 (Agentic Reviews), F-008 (Multi-File Analysis) | Q3 2026 |
| v5.0.0 | F-009 (RAG), F-010 (CI/CD), F-011 (Analytics), F-012 (Knowledge Base) | Q4 2026 |
| v6.0.0 | F-013–F-020 (Developer Experience & Ecosystem) | Q1–Q2 2027 |

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

**Status:** 📋 Planned
**Priority:** 🟠 P1 — High Impact, Medium Effort
**Effort:** Medium (3–4 days)

#### Overview

Run a fast AI review automatically when the user triggers `git commit` from VS Code's Source Control panel. If the review finds issues above a configurable severity threshold, block the commit and show findings inline.

#### User Problem

Issues caught after a commit require an additional fix commit. Catching them at commit time keeps history cleaner and builds good habits without leaving VS Code.

#### Configuration

```json
"ollama-code-review.preCommitGuard.enabled": false,
"ollama-code-review.preCommitGuard.blockOnSeverity": "high",
"ollama-code-review.preCommitGuard.timeoutSeconds": 60
```

`blockOnSeverity` values: `"critical"` | `"high"` | `"medium"` | `"low"` | `"off"`

#### Workflow

1. User runs `git commit` from Source Control or the command palette
2. Extension intercepts via `onWillSaveTextDocument` or a pre-commit shell hook written to `.git/hooks/pre-commit` (user opt-in)
3. Runs a condensed review prompt on staged diff
4. If no finding meets/exceeds threshold → commit proceeds
5. If findings found → modal shows findings, user can **Commit Anyway** or **Cancel**

#### Implementation Notes

- Hook file written by extension on first enable; removed on disable
- Hook calls `code --command ollama-code-review.runPreCommitCheck` and reads exit code
- Timeout prevents blocking commits when model is slow or unreachable
- Use the active review profile for the pre-commit prompt

#### Acceptance Criteria

- [ ] Opt-in only — disabled by default
- [ ] Hook written/removed cleanly on setting toggle
- [ ] Findings shown in a modal with severity badges
- [ ] Timeout respected; commit proceeds if model unreachable
- [ ] Works across all supported providers

---

### F-015: GitLab & Bitbucket PR Integration

**Status:** 📋 Planned
**Priority:** 🟡 P2 — High Impact, High Effort
**Effort:** High (5–8 days)

#### Overview

Extend the GitHub PR Integration (F-004) to support GitLab Merge Requests and Bitbucket Pull Requests. Users on GitLab/Bitbucket can fetch PR diffs, run AI reviews, and post results as MR/PR comments.

#### User Problem

A large portion of teams use GitLab or Bitbucket. The GitHub-only F-004 leaves them unable to use the PR review workflow.

#### Configuration

```json
"ollama-code-review.gitlab.token": "",
"ollama-code-review.gitlab.baseUrl": "https://gitlab.com",
"ollama-code-review.bitbucket.username": "",
"ollama-code-review.bitbucket.appPassword": "",
"ollama-code-review.bitbucket.workspace": ""
```

#### New Commands

| Command | Description |
|---------|-------------|
| `ollama-code-review.reviewGitLabMR` | Fetch and review a GitLab MR by URL or `!123` |
| `ollama-code-review.postReviewToMR` | Post review as a MR note |
| `ollama-code-review.reviewBitbucketPR` | Fetch and review a Bitbucket PR by URL |
| `ollama-code-review.postReviewToBitbucketPR` | Post review as a Bitbucket PR comment |

#### Architecture

- Add `src/gitlab/` and `src/bitbucket/` modules mirroring `src/github/` structure
- `auth.ts`, `prReview.ts`, `commentMapper.ts` for each platform
- Shared `PRReference` interface extended with `platform: 'github' | 'gitlab' | 'bitbucket'`
- Auto-detect platform from remote URL (`git@gitlab.com`, `bitbucket.org`)

#### Acceptance Criteria

- [ ] `git remote` URL auto-detects GitLab / Bitbucket
- [ ] GitLab MR diff fetched and reviewed correctly
- [ ] Bitbucket PR diff fetched and reviewed correctly
- [ ] Review posted as comment with correct formatting for each platform
- [ ] Auth errors surface clear guidance for obtaining tokens

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

- [ ] Score extracted from AI response or computed by heuristic
- [ ] Score stored locally per review
- [ ] Status bar updated after every review
- [ ] Trend chart renders correctly for ≥ 2 reviews
- [ ] Scores survive VS Code restart

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

- [ ] Slack message delivered when webhook URL configured
- [ ] Teams card delivered when webhook URL configured
- [ ] Discord message delivered when webhook URL configured
- [ ] `triggerOn` filter respected — no spurious notifications for clean reviews
- [ ] Notification failures logged but do not interrupt review flow

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

- [ ] Single file reviewed end-to-end without Git
- [ ] Folder review respects include/exclude globs
- [ ] Selection review works from right-click context menu
- [ ] Token budget respected — large folders chunked across multiple calls with results merged
- [ ] Review panel shows filename(s) reviewed in the header

---

### F-020: Architecture Diagram Generation (Mermaid)

**Status:** 📋 Planned
**Priority:** 🟢 P3 — Medium Impact, High Effort
**Effort:** High (5–7 days)

#### Overview

Generate a Mermaid.js diagram from a code diff or set of files, showing how changed components relate to one another. The diagram is embedded in the review output or can be copied independently.

#### User Problem

Text-based reviews describe *what* changed but rarely show *how* the changes affect the system's structure. A Mermaid diagram makes architectural impact immediately visible in PRs and documentation.

#### Diagram Types

| Mode | Trigger | Output |
|------|---------|--------|
| **Class Diagram** | Classes / interfaces detected in diff | UML-style class relationships |
| **Flowchart** | Functions / call chains detected | Control flow between functions |
| **Sequence Diagram** | API calls / async patterns detected | Request/response sequences |
| **Component Diagram** | Import graph from changed files | Module dependency graph |

#### New Command

`ollama-code-review.generateDiagram` — available from the review panel toolbar and the command palette.

#### Implementation Notes

- A second AI call (same model) generates the Mermaid block: `"Output a valid Mermaid diagram that visualizes the structure of the following diff. Choose the most appropriate diagram type."`
- Mermaid rendered in the review panel via the Mermaid.js CDN (added alongside highlight.js)
- "Copy Diagram" button copies raw Mermaid source for pasting into GitHub Markdown, Notion, etc.
- "Export as SVG" button renders via `mermaid.render()` and downloads the SVG file

#### Acceptance Criteria

- [ ] Diagram generated for a TypeScript class diff without manual type selection
- [ ] Mermaid renders correctly in the review panel
- [ ] Copy and SVG export buttons functional
- [ ] Graceful fallback message if model output is not valid Mermaid syntax
- [ ] Diagram generation is a separate optional call — does not slow down the main review

---
