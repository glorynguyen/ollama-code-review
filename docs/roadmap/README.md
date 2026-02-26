# Ollama Code Review - Product Roadmap

> **Document Version:** 5.0.0
> **Last Updated:** 2026-02-21
> **Status:** Active Development
> **Owner:** Vinh Nguyen

## Overview

This roadmap outlines future enhancements for the Ollama Code Review VS Code extension. Features are organized by phase, priority, and estimated effort to guide development decisions.

## Quick Navigation

| Document | Description |
|----------|-------------|
| [FEATURES.md](./FEATURES.md) | Detailed feature specifications |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture decisions |
| [CHANGELOG.md](../CHANGELOG.md) | Release history |

## What's Been Shipped

All original roadmap features (F-001 through F-020, S-001 through S-005) have shipped as of v5.0.0:

```
✅ Shipped ─────── Smart Diff Filtering (F-002)
                   Inline Code Actions (F-005) — Explain, Tests, Fix, Docs
                   Customizable Prompts (F-006) — settings + .ollama-review.yaml
                   Multi-Provider Cloud Support (8 providers, S-001)
                   Agent Skills System, multi-repo + multi-skill (S-002)
                   Performance Metrics, per-provider (S-003)
                   Interactive Chat, multi-turn follow-ups (S-004)
                   HF Model Picker, recent/popular/custom (S-005)
                   Review Profiles & Presets (F-001) — 6 built-in + custom
                   Export Options — clipboard/markdown/PR desc/Gist (F-003)
                   GitHub PR Integration (F-004) — review PRs, post comments
                   PHP language support + multi-strategy GitHub auth (v3.4)
                   OpenAI-Compatible Provider (F-013) — LM Studio, vLLM, etc.
                   Pre-Commit Guard (F-014) — hook-based review before commits
                   Multi-File Contextual Analysis (F-008) — import resolution
                   Compliance Review Profiles (F-017) — OWASP, PCI-DSS, etc.
                   Review Quality Scoring & Trends (F-016)
                   Notification Integrations (F-018) — Slack/Teams/Discord
                   Batch / Legacy Code Review (F-019) — files/folders/selections
                   Agentic Multi-Step Reviews (F-007) — 5-step pipeline
                   Architecture Diagram Generation (F-020) — Mermaid.js
                   Review History & Analytics (F-011) — dashboard + export
                   Team Knowledge Base (F-012) — decisions/patterns/rules YAML
                   GitLab & Bitbucket Integration (F-015) — MR/PR reviews
                   RAG-Enhanced Reviews (F-009) — semantic codebase indexing
                   CI/CD Integration (F-010) — headless CLI + CI templates
```

## Remaining Roadmap — Phase 6: AI Assistant Evolution

```
v6.0 (2026) ───── extension.ts Decomposition (F-027) — refactor into modules
                   Provider Abstraction Layer (F-025) — unified ModelProvider interface
                   Streaming Responses (F-022) — SSE streaming for all providers
                   Sidebar Chat Panel (F-021) — persistent WebviewViewProvider chat
                   @-Context Mentions in Chat (F-023) — @file, @diff, @review, @codebase
                   Inline Edit Mode (F-024) — highlight code, describe change, AI applies
                   Rules Directory (F-026) — .ollama-review/rules/*.md team standards
```

## Priority Matrix (Phase 6 Features)

| Priority | Impact | Effort | Features |
|----------|--------|--------|----------|
| 🔴 P0 | Critical | Medium | F-027: extension.ts Decomposition (unblocks all Phase 6 work) |
| 🔴 P0 | High | Medium | F-025: Provider Abstraction Layer (prerequisite for streaming) |
| 🟠 P1 | High | Medium | F-022: Streaming Responses (UX improvement, prerequisite for chat) |
| 🟠 P1 | Very High | High | F-021: Sidebar Chat Panel (flagship feature) |
| 🟡 P2 | High | Medium | F-023: @-Context Mentions in Chat |
| 🟡 P2 | High | High | F-024: Inline Edit Mode |
| 🟢 P3 | Medium | Low | F-026: Rules Directory |

## Recommended Implementation Order

```
1. F-027  extension.ts Decomposition     ← Do first: unblocks everything
2. F-025  Provider Abstraction Layer      ← Unified interface for streaming
3. F-022  Streaming Responses             ← Immediate UX win
4. F-021  Sidebar Chat Panel              ← Flagship: transforms extension identity
5. F-023  @-Context Mentions              ← Makes chat workspace-aware
6. F-024  Inline Edit Mode                ← Natural evolution after chat + streaming
7. F-026  Rules Directory                 ← Low effort, do anytime
```

## Phase 8: Review Experience (v8.0)

```
v8.0 (2026) ───── Review Annotations (F-029) — inline editor decorations for findings
```

| Priority | Impact | Effort | Features |
|----------|--------|--------|----------|
| 🟠 P1 | High | Low | F-029: Review Annotations (inline gutter/highlight/hover for findings) |

## Current Status

- **Current Version:** 8.0.0
- **Next Milestone:** v8.0.0 (Review Experience)
- **Theme:** Bring review findings into the editor for immediate, in-context visibility

---

## How to Use This Roadmap

### For Development
1. Check `FEATURES.md` for detailed specs before implementing
2. Reference `ARCHITECTURE.md` for technical decisions
3. Update status in feature files as progress is made

### For Contributors
1. F-027 (extension.ts Decomposition) — prerequisite refactor, well-scoped
2. F-025 (Provider Abstraction) — clear interface design, refactor existing code
3. F-022 (Streaming) — independent per-provider work, parallelizable
4. Open issues to discuss implementation approaches
5. PRs should reference the feature ID (e.g., `F-021`)

### Status Legend
- `📋 Planned` - Specified, not started
- `🔄 In Progress` - Active development
- `✅ Complete` - Shipped
- `⏸️ On Hold` - Blocked or deprioritized
