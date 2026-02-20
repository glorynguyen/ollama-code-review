# Ollama Code Review - Product Roadmap

> **Document Version:** 4.0.0
> **Last Updated:** 2026-02-20
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

All original roadmap phases through v4.5.0 have shipped:

```
✅ Shipped ─────── Smart Diff Filtering (F-002)
                   Inline Code Actions (F-005) — Explain, Tests, Fix, Docs
                   Customizable Prompts (F-006) — settings + .ollama-review.yaml
                   Multi-Provider Cloud Support (7 providers, S-001)
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
```

## Remaining Roadmap

```
v5.0 (Q4 2026) ── RAG-Enhanced Reviews (F-009)
                   CI/CD Integration (F-010)
```

## Priority Matrix (Remaining Features)

| Priority | Impact | Effort | Features |
|----------|--------|--------|----------|
| 🟡 P2 | High | High | F-009: RAG-Enhanced Reviews |
| 🟢 P3 | Medium | High | F-010: CI/CD Integration |

## Current Status

- **Current Version:** 4.5.0
- **Next Milestone:** v5.0.0 (RAG-Enhanced Reviews + CI/CD Integration)
- **Target Release:** Q4 2026

---

## How to Use This Roadmap

### For Development
1. Check `FEATURES.md` for detailed specs before implementing
2. Reference `ARCHITECTURE.md` for technical decisions
3. Update status in feature files as progress is made

### For Contributors
1. F-009 (RAG-Enhanced Reviews) — uses existing embeddings infrastructure, high impact
2. F-010 (CI/CD Integration) — clear scope, CLI extraction + GitHub Action
3. Open issues to discuss implementation approaches
4. PRs should reference the feature ID (e.g., `F-009`)

### Status Legend
- `📋 Planned` - Specified, not started
- `🔄 In Progress` - Active development
- `✅ Complete` - Shipped
- `⏸️ On Hold` - Blocked or deprioritized
