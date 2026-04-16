# Feature Proposals: Ollama Code Review

## Overview
The Ollama Code Review extension has reached a high level of maturity (v3.41.1) with comprehensive coverage of multi-provider AI reviews, Git integrations, and agentic workflows. To further distinguish the extension and improve developer productivity, the following features are proposed to move the tool from a "reporting" assistant to an "active resolution" partner.

---

## 1. Batch "Fix All" Findings (F-045)
**Goal:** Streamline the "Review → Find → Fix" loop by allowing users to apply multiple AI-suggested fixes in a single operation.

### Feature Detail
- **UI Integration:** Add a "Fix All" action to the `AI Review: Findings` view title and per-file nodes in the sidebar.
- **Workflow:**
    1. Group all findings with file/line references by file.
    2. For each file, the AI receives the code and all associated findings to generate a unified update.
    3. Present a unified diff preview (extending the current `FixPreviewPanel`) for the user to review and accept the entire set of changes.
- **Value:** Significantly reduces the friction of addressing dozens of small style or documentation findings, making the extension feel like a "one-click" refactoring tool.

---

## 2. Impact-Aware Reviews (Strategic Enhancement) ✅ **COMPLETED**
**Goal:** Leverage the existing `DependencyRegistry` (Impact Graph Agent) to provide "Senior Engineer" level architectural insights during code reviews.

### Feature Detail
- **Context Injection:** When running a review, automatically query the `DependencyRegistry` for downstream files that import the changed files.
- **AI Guidance:** Include impact metadata in the prompt: *"The following 5 files depend on `src/utils.ts`. Special attention required for public API signature changes."*
- **Proactive Warnings:** If the AI detects a signature change in a highly-imported file, it can proactively warn: *"⚠️ Breaking Change: Updating `fetchUser` will impact 12 downstream consumers. Consider adding a deprecated fallback."*
- **Implementation:** Integrated into Standard, Streaming, Pre-Commit, and Agentic review pipelines.
- **Value:** Moves beyond local code quality to provide cross-file architectural safety.

---

## 3. Review History & Findings Persistence (F-048) ✅ **COMPLETED**
**Goal:** Enable users to revisit past reviews and track finding resolution across VS Code sessions.

### Feature Detail
- **Persistence:** Updated `ReviewScoreStore` to save the full `ValidatedStructuredReviewResult` and original `diff` in global storage.
- **History Navigation:** Enhanced the `Review History` panel with a "Restore" button to reload findings back into the sidebar and editor.
- **Value:** Solves the "session loss" problem and allows tracking quality trends over time with full context.

---

## Implementation Roadmap

### Phase 1: Persistence (Quick Win)
- Modify `src/reviewScore.ts` to include a `findings` field in the `ReviewScore` interface.
- Update `ReviewScoreStore.addScore` to serialize findings to the local JSON store.

### Phase 2: Impact Integration (Architectural value)
- Update `runReview` in `src/commands/index.ts` to fetch importers from `DependencyRegistry`.
- Append a "Downstream Impact" section to the AI prompt in `src/reviewPromptBuilder.ts`.

### Phase 3: Batch Fixing (UX Multiplier)
- Create `generateBatchFix` in `src/commands/aiActions.ts` that handles multiple instructions for one file.
- Update `FindingsTreeProvider` to support a "Fix All" command that iterates through the tree.
