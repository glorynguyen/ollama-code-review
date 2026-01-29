# Ollama Code Review - Product Roadmap

> **Document Version:** 1.0.0
> **Last Updated:** 2025-01-29
> **Status:** Active Planning
> **Owner:** Vinh Nguyen

## Overview

This roadmap outlines future enhancements for the Ollama Code Review VS Code extension. Features are organized by phase, priority, and estimated effort to guide development decisions.

## Quick Navigation

| Document | Description |
|----------|-------------|
| [FEATURES.md](./FEATURES.md) | Detailed feature specifications |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture decisions |
| [CHANGELOG.md](../CHANGELOG.md) | Release history |

## Roadmap Summary

```
Phase 1 (v2.0) ─── Review Profiles & Presets
       │          Smart Diff Filtering
       │          Export Options
       │
Phase 2 (v2.5) ─── GitHub PR Integration
       │          Inline Code Actions
       │          Customizable Prompts
       │
Phase 3 (v3.0) ─── Agentic Multi-Step Reviews
       │          Multi-File Contextual Analysis
       │          RAG-Enhanced Reviews
       │
Phase 4 (v4.0) ─── CI/CD Integration
                  Review History & Analytics
                  Team Knowledge Base
```

## Priority Matrix

| Priority | Impact | Effort | Features |
|----------|--------|--------|----------|
| 🔴 P0 | High | Low-Med | Review Profiles, Smart Diff Filtering |
| 🟠 P1 | High | Medium | GitHub PR Integration, Export Options |
| 🟡 P2 | High | High | Agentic Reviews, RAG Integration |
| 🟢 P3 | Medium | Variable | Analytics, Team Knowledge Base |

## Current Status

- **Current Version:** 1.9.0
- **Next Milestone:** v2.0.0 (Review Profiles)
- **Target Release:** Q2 2025

---

## How to Use This Roadmap

### For Development
1. Check `FEATURES.md` for detailed specs before implementing
2. Reference `ARCHITECTURE.md` for technical decisions
3. Update status in feature files as progress is made

### For Contributors
1. Pick features from Phase 1-2 for immediate impact
2. Open issues to discuss implementation approaches
3. PRs should reference the feature ID (e.g., `F-001`)

### Status Legend
- `📋 Planned` - Specified, not started
- `🔄 In Progress` - Active development
- `✅ Complete` - Shipped
- `⏸️ On Hold` - Blocked or deprioritized
