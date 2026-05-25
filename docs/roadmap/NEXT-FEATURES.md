# Next Feature Suggestions for Ollama Code Review

## Current State

All roadmap features (F-001 through F-034, F-037, F-043, F-044), plus F-045 and F-047, are shipped. The extension has comprehensive coverage of: multi-provider AI reviews, findings navigation, single-finding and batch fixes, annotations, analytics, review coverage, sidebar chat, inline edit, secret scanning, model recommendations, and more.

## Top Feasible Feature Suggestions

Ranked by **impact x feasibility**, building on existing infrastructure:

---

### 1. Batch Fix All Findings (F-045) — **Implemented**

**What:** A "Fix All" button in the Findings Explorer toolbar that iterates through all actionable findings and generates AI fixes in sequence (or parallel), presenting a unified diff preview for the user to accept/reject per file.

**Why it's the natural next step:**
- F-033 (Quick Fix) already handles single findings — this extends the loop
- `FindingsTreeProvider.getFindings()` already returns all parsed findings
- `generateFix()` in `src/commands/aiActions.ts` already generates fixes
- `FixPreviewPanel` already previews diffs
- Users currently must click the wrench icon on each finding individually — tedious for reviews with 10+ findings

**Implemented with:**
- `src/commands/findingsCommands.ts` — `fixAllFindings` command, progress loop, skipped-finding handling, and batch preview launch
- `src/codeActions/fixAction.ts` — batch preview panel, overlap filtering, bottom-to-top apply ordering, and stale-code recovery
- `package.json` — command contribution and Findings Explorer toolbar action
- `src/test/batchFix.test.ts` — command contribution, overlap filtering, sorting, validation, and apply behavior

---

### 2. Review Diff Caching / Deduplication (F-046) — **Implemented**

**What:** Hash the review prompt (diff + profile + skills + model) and cache the result. If the same diff is reviewed again with the same config, return the cached result instantly instead of making an API call. Show a "(cached)" badge.

**Why:** Saves API costs and time. Users often re-run reviews after switching tabs or restarting VS Code. The analytics store (`review-scores.json`) already persists data — this follows the same pattern.

**Implemented with:**
- `src/reviewCache.ts` — hash-based cache with TTL and max-entry pruning
- `src/commands/index.ts` — cache lookup/storage around structured review generation
- `src/reviewProvider.ts` — "Cached" badge and cache metadata in System Info
- `package.json` — `cache.enabled`, `cache.ttlMinutes`, and `cache.maxEntries` settings

---

### 3. Review Coverage Tracking (F-047) — **Implemented**

**What:** Track which files in the workspace have been reviewed (and when), and show a "Review Coverage" tree view or status bar indicator. Highlight un-reviewed files in the explorer with a decoration. Goal: help teams ensure all critical files get reviewed.

**Why:** The analytics tracker already stores `filesReviewed` per review entry. This feature surfaces that data in a useful way. Pairs well with the existing Findings Explorer sidebar.

**Implemented with:**
- `src/reviewCoverage/coverageProvider.ts` — TreeDataProvider showing never-reviewed, stale, reviewed-with-findings, and recently reviewed files
- `package.json` — Coverage view, commands, menus, activation event, and settings
- `src/commands/index.ts` — refresh/copy/open/review/restore commands and coverage refresh after reviews
- `docs-site/docs/features/continuous-feedback.md` — docs-site user guide entry
- `docs-site/docs/reference/settings.md` — docs-site settings reference
- `src/test/reviewCoverage.test.ts` — grouping logic and contribution coverage

---

### 4. Findings Persistence Across Sessions (F-048)

**What:** Currently, findings in the Findings Explorer and inline annotations are lost when VS Code restarts. Persist the last review's findings to globalStorage and restore them on activation. Include a "Review age" indicator (e.g., "Reviewed 2h ago").

**Why:** Users lose context when they close and reopen VS Code. The scoring system already persists to JSON — findings can follow the same pattern.

**Effort:** Low (1-2 days)
**Files to modify:**
- `src/reviewFindings/findingsTreeProvider.ts` — add save/restore from globalStorage
- `src/reviewDecorations.ts` — restore annotations on activation
- `src/commands/index.ts` — trigger restore in `activate()`

---

### 5. Smart Review Suggestions (F-049) — **Implemented**

**What:** After a review completes, show a "Suggested Actions" panel with prioritized next steps: "3 findings are auto-fixable", "Run security profile for auth changes detected", "Related PR #42 had similar findings". Uses the existing findings data + diff analysis to surface contextual suggestions.

**Why:** Connects the dots between existing features (findings, profiles, PR integration, knowledge base) into an intelligent workflow assistant.

**Implemented with:**
- `src/smartSuggestions/types.ts` — Type definitions (SmartSuggestion, SuggestionInput, SuggestionResult)
- `src/smartSuggestions/analyzer.ts` — Core logic: fix, profile, trend, and workflow suggestion generators
- `src/smartSuggestions/index.ts` — Barrel exports
- `src/commands/index.ts` — Integration after review completion (post-notifications, pre-panel display)
- `src/test/smartSuggestions.test.ts` — 38 unit tests with full coverage
- `docs-site/docs/features/smart-suggestions.md` — User documentation

---

## Recommendation

**Next pick: #4 (Findings Persistence)** because:
- It preserves review context across VS Code restarts.
- It builds directly on the structured findings and review history data already stored locally.
- It is a quick workflow polish item now that batch fixes, caching, coverage, and smart suggestions are in place.
