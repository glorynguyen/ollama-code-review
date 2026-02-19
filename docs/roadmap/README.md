# Ollama Code Review - Product Roadmap

> **Document Version:** 3.0.0
> **Last Updated:** 2026-02-18
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

All original roadmap phases through v3.4.0 have shipped:

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
```

## Remaining Roadmap

```
v4.0 (Q3 2026) ── Agentic Multi-Step Reviews (F-007)
       │           Multi-File Contextual Analysis (F-008)
       │
v5.0 (Q4 2026) ── RAG-Enhanced Reviews (F-009)
       │           CI/CD Integration (F-010)
       │           Review History & Analytics (F-011)
       │           Team Knowledge Base (F-012)
       │
v6.0 (Q1-Q2   ── OpenAI-Compatible Provider (F-013)
      2027)        Pre-Commit Guard (F-014)
                   GitLab & Bitbucket Integration (F-015)
                   Review Quality Scoring & Trends (F-016)
                   Notification Integrations (F-018)
                   Batch / Legacy Code Review (F-019)
                   Architecture Diagram Generation (F-020)
```

## Priority Matrix (Remaining Features)

| Priority | Impact | Effort | Features |
|----------|--------|--------|----------|
| 🟠 P1 | High | High | F-007: Agentic Reviews, F-008: Multi-File Analysis |
| 🟠 P1 | High | Low | F-013: OpenAI-Compatible Provider, F-014: Pre-Commit Guard |
| 🟡 P2 | High | High | F-009: RAG, F-015: GitLab & Bitbucket Integration |
| 🟡 P2 | High | Medium | F-016: Review Quality Scoring, F-019: Batch Code Review |
| 🟢 P3 | Medium | High | F-010: CI/CD, F-012: Knowledge Base, F-020: Diagram Generation |
| 🟢 P3 | Medium | Low | F-011: Analytics, F-018: Notification Integrations |

## Current Status

- **Current Version:** 3.4.0
- **Next Milestone:** v4.0.0 (Agentic Reviews + Multi-File Analysis)
- **Target Release:** Q3 2026

---

## How to Use This Roadmap

### For Development
1. Check `FEATURES.md` for detailed specs before implementing
2. Reference `ARCHITECTURE.md` for technical decisions
3. Update status in feature files as progress is made

### For Contributors
1. F-013 (OpenAI-Compatible Provider) and F-017 (Compliance Profiles) are best next picks — low dependencies, high impact, low effort
2. F-014 (Pre-Commit Guard) and F-019 (Batch Review) are good solo contributions with clear scope
3. Open issues to discuss implementation approaches
4. PRs should reference the feature ID (e.g., `F-013`)

### Status Legend
- `📋 Planned` - Specified, not started
- `🔄 In Progress` - Active development
- `✅ Complete` - Shipped
- `⏸️ On Hold` - Blocked or deprioritized
