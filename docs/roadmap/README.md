# Ollama Code Review - Product Roadmap

> **Document Version:** 2.0.0
> **Last Updated:** 2026-02-17
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

Several features have been completed — both from the original roadmap and organically during development:

```
✅ Shipped ─────── Smart Diff Filtering (F-002)
                   Inline Code Actions (F-005) — Explain, Tests, Fix, Docs
                   Customizable Prompts (F-006, partial — settings only)
                   Multi-Provider Cloud Support (7 providers)
                   Agent Skills System (multi-repo, multi-skill)
                   Performance Metrics (per-provider token/duration tracking)
                   Interactive Chat (multi-turn follow-ups in review panel)
                   HF Model Picker (recent/popular/custom submenu)
```

## Remaining Roadmap

```
Next (v3.1) ────── Review Profiles & Presets (F-001)
       │           Export Options (F-003)
       │
v3.5 ──────────── GitHub PR Integration (F-004)
       │           Customizable Prompts remainder (F-006, .yaml config)
       │
v4.0 ──────────── Agentic Multi-Step Reviews (F-007)
       │           Multi-File Contextual Analysis (F-008)
       │
v5.0 ──────────── RAG-Enhanced Reviews (F-009)
                   CI/CD Integration (F-010)
                   Review History & Analytics (F-011)
                   Team Knowledge Base (F-012)
```

## Priority Matrix (Remaining Features)

| Priority | Impact | Effort | Features |
|----------|--------|--------|----------|
| 🔴 P0 | High | Medium | F-001: Review Profiles |
| 🟠 P1 | High | Low | F-003: Export Options |
| 🟠 P1 | High | High | F-004: GitHub PR Integration |
| 🟡 P2 | High | High | F-007: Agentic Reviews, F-008: Multi-File Analysis |
| 🟢 P3 | Medium | High | F-009: RAG, F-010: CI/CD, F-011: Analytics, F-012: Knowledge Base |

## Current Status

- **Current Version:** 3.0.0
- **Next Milestone:** v3.1.0 (Review Profiles + Export Options)
- **Target Release:** Q1 2026

---

## How to Use This Roadmap

### For Development
1. Check `FEATURES.md` for detailed specs before implementing
2. Reference `ARCHITECTURE.md` for technical decisions
3. Update status in feature files as progress is made

### For Contributors
1. F-001 and F-003 are the best next features to pick up (low dependencies, high impact)
2. Open issues to discuss implementation approaches
3. PRs should reference the feature ID (e.g., `F-001`)

### Status Legend
- `📋 Planned` - Specified, not started
- `🔄 In Progress` - Active development
- `✅ Complete` - Shipped
- `⏸️ On Hold` - Blocked or deprioritized
