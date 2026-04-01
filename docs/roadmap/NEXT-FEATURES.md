# Next Feature Suggestions for Ollama Code Review

## Current State

All roadmap features (F-001 through F-034, F-037, F-043, F-044) are shipped as of v3.41.1. The extension has comprehensive coverage of: multi-provider AI reviews, findings navigation, single-finding quick fix, annotations, analytics, sidebar chat, inline edit, secret scanning, model recommendations, and more.

## Top 5 Feasible Feature Suggestions

Ranked by **impact x feasibility**, building on existing infrastructure:

---

### 1. Batch Fix All Findings (F-045) — **Recommended First Pick**

**What:** A "Fix All" button in the Findings Explorer toolbar that iterates through all actionable findings and generates AI fixes in sequence (or parallel), presenting a unified diff preview for the user to accept/reject per file.

**Why it's the natural next step:**
- F-033 (Quick Fix) already handles single findings — this extends the loop
- `FindingsTreeProvider.getFindings()` already returns all parsed findings
- `generateFix()` in `src/commands/aiActions.ts` already generates fixes
- `FixPreviewPanel` already previews diffs
- Users currently must click the wrench icon on each finding individually — tedious for reviews with 10+ findings

**Effort:** Low-Medium (2-3 days)
**Files to modify:**
- `src/reviewFindings/findingsTreeProvider.ts` — add "Fix All" toolbar button
- `src/commands/index.ts` — register `fixAllFindings` command
- `src/commands/aiActions.ts` — add batch fix orchestration (sequential with progress)
- `package.json` — register command + toolbar icon

---

### 2. Review Diff Caching / Deduplication (F-046)

**What:** Hash the review prompt (diff + profile + skills + model) and cache the result. If the same diff is reviewed again with the same config, return the cached result instantly instead of making an API call. Show a "(cached)" badge.

**Why:** Saves API costs and time. Users often re-run reviews after switching tabs or restarting VS Code. The analytics store (`review-scores.json`) already persists data — this follows the same pattern.

**Effort:** Low (1-2 days)
**Files to modify:**
- `src/commands/index.ts` — add cache check before `getOllamaReview()`
- New file: `src/reviewCache.ts` — hash-based cache with TTL and size limit
- `src/reviewProvider.ts` — show "(cached)" indicator
- `package.json` — add `cache.enabled`, `cache.ttlMinutes`, `cache.maxEntries` settings

---

### 3. Review Coverage Tracking (F-047)

**What:** Track which files in the workspace have been reviewed (and when), and show a "Review Coverage" tree view or status bar indicator. Highlight un-reviewed files in the explorer with a decoration. Goal: help teams ensure all critical files get reviewed.

**Why:** The analytics tracker already stores `filesReviewed` per review entry. This feature surfaces that data in a useful way. Pairs well with the existing Findings Explorer sidebar.

**Effort:** Medium (3-4 days)
**Files to modify:**
- New file: `src/reviewCoverage/coverageProvider.ts` — TreeDataProvider showing reviewed vs un-reviewed files
- `src/analytics/tracker.ts` — add `getReviewedFiles()` aggregation
- `package.json` — register tree view under existing `ai-review` activity bar
- `src/commands/index.ts` — register commands

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

### 5. Smart Review Suggestions (F-049)

**What:** After a review completes, show a "Suggested Actions" panel with prioritized next steps: "3 findings are auto-fixable", "Run security profile for auth changes detected", "Related PR #42 had similar findings". Uses the existing findings data + diff analysis to surface contextual suggestions.

**Why:** Connects the dots between existing features (findings, profiles, PR integration, knowledge base) into an intelligent workflow assistant.

**Effort:** Medium (3-5 days)

---

## Recommendation

**Start with #1 (Batch Fix All Findings)** because:
- Lowest risk — builds entirely on proven infrastructure (F-033, F-031)
- Highest immediate UX impact — eliminates the most tedious manual step in the review workflow
- Clear scope — no new UI paradigms, just a toolbar button + progress loop
- Completes the "review → find → fix" loop that F-031/F-033/F-034 started

Then follow with **#4 (Findings Persistence)** as a quick win, and **#2 (Review Caching)** for API cost savings.
