# 🗺️ Ollama Code Review — Feature Roadmap

> **Current version:** v3.31.0 | **Last updated:** 2026-03-11

---

## ✅ Current Feature Inventory

| # | Feature | Since |
|---|---------|-------|
| F-001 | Review Profiles & Presets (general, security, performance, etc.) | v3.1.0 |
| F-003 | Export Options (Markdown, PDF, Gist) | v3.2.0 |
| F-004 | GitHub PR Review + post inline/summary comments | v3.3.0 |
| F-005 | Inline Code Actions (Explain, Fix, Generate Tests, Add Docs) | v1.18.0 |
| F-006 | `.ollama-review.yaml` project config file | v3.4.0 |
| F-007 | Agentic Multi-Step Reviews | v3.10.0 |
| F-008 | Multi-file Contextual Analysis (import resolution) | v3.7.0 |
| F-009 | RAG-Enhanced Reviews (vector-indexed codebase) | v3.14.0 |
| F-010 | CI/CD Integration | v3.14.0 |
| F-011 | Review History & Analytics Dashboard | v3.11.0 |
| F-012 | Team Knowledge Base (`.ollama-review-knowledge.yaml`) | v3.12.0 |
| F-013 | OpenAI-compatible Provider (LM Studio, vLLM, LocalAI, Groq…) | v3.5.0 |
| F-014 | Pre-Commit Guard (install/uninstall git hook) | v3.6.0 |
| F-015 | GitLab MR + Bitbucket PR integrations | v3.13.0 |
| F-016 | Review Quality Score (status bar badge) | v3.9.0 |
| F-017 | Compliance Profiles (OWASP, PCI-DSS, GDPR, HIPAA, SOC2, NIST) | v3.8.0 |
| F-018 | Notifications (Slack, Teams, Discord) | v3.9.0 |
| F-019 | Batch Review | v3.9.0 |
| F-020 | Mermaid Architecture Diagram Generator | v3.10.0 |
| F-022 | Streaming Responses | v3.15.0 |
| F-023 | `@`-context mentions in sidebar chat | v3.18.0 |
| F-024 | Inline Edit Mode with streaming diff preview | v3.21.0 |
| F-026 | Rules Directory (`.ollama-review/rules/`) | v3.15.0 |
| F-028 | Semantic Version Bump Advisor | v3.22.0 |
| F-029 | Review Annotations — inline editor decorations | v3.23.0 |
| F-030 | Multi-Model Review Comparison | v3.24.0 |
| F-031 | Review Findings Explorer (sidebar tree view) | v3.25.0 |
| F-032 | Contentstack Schema Validation | v3.26.0 |
| F-033 | Quick Fix from Review Findings | v3.27.0 |
| F-042 | AI-powered Secret Scanner (Deterministic regex scan) | v3.31.0 |
| —   | Jira ticket prefix in commit messages | v3.31.0 |
| —   | Copy File with Imports (for LLM context) | v3.29.0 |
| —   | Structured Review with anchor validation | v3.29.0 |
| —   | Multi-cloud model support (Claude, Gemini, Mistral, HF, MiniMax, GLM) | various |

---

## 🚀 Proposed New Features

### Theme 1 — Developer Experience

#### F-034 · Smart Review Caching & Diff-based Invalidation
**Rationale:** Large diffs can re-trigger the same costly LLM call even though only a small patch changed since the last review. Caching the review result keyed to the diff hash would make re-reviews near-instant.

**Implementation idea:**
- Hash the diff + profile + model + rules content.
- Store result in `globalStoragePath` (TTL: 1 hour, configurable).
- Show a "⚡ Cached" badge in the review panel with a "Re-run" button.

**Complexity:** Medium | **Impact:** High

---

#### F-035 · Review Templates per File Type / Pattern
**Rationale:** `.sql` files need a different prompt from `.tsx` components. Today the user has one review profile for everything.

**Implementation idea:**
- Extend `.ollama-review.yaml` with a `fileTemplates` map (glob → prompt snippet).
- Merge the matching template into the base prompt before sending.

**Complexity:** Low | **Impact:** Medium

---

#### F-036 · `@todo` / `@fixme` Finder in Staged Diff
**Rationale:** Developers sometimes accidentally commit unresolved `TODO`, `FIXME`, or `HACK` markers. This feature would surface them as warnings before commit.

**Implementation idea:**
- Scan the staged diff for marker patterns before running the AI review.
- Attach warnings to the Pre-Commit Guard output and the findings tree.

**Complexity:** Low | **Impact:** Medium

---

### Theme 2 — AI Intelligence

#### F-037 · Auto-detect & Suggest the Best Model for the Task
**Rationale:** Users with multiple models available pick one ad-hoc. The extension could recommend the best model based on file language, diff size, and task type (review vs. commit message vs. diagram).

**Implementation idea:**
- Build a lightweight heuristic map: large TypeScript diff → `qwen3-coder`, security profile → `claude-opus`, small fix → `gemini-flash`.
- Show a "Recommended: X" hint in the model picker.
- Add a `ollama-code-review.autoSelectModel` boolean setting.

**Complexity:** Medium | **Impact:** High

---

#### F-038 · Conversational Review Follow-up in Sidebar Chat
**Rationale:** The sidebar chat already exists (F-023) but it's general. A focused "drill into this finding" mode would let developers ask "why is this a security issue?" with full finding context pre-loaded.

**Implementation idea:**
- Add an "Ask AI" icon button on each finding in the Findings Explorer tree.
- On click, open the sidebar chat with a system message pre-populated with the finding details and code snippet.

**Complexity:** Low | **Impact:** High

---

#### F-039 · Review Trend Alerts (Quality Regression Detection)
**Rationale:** The review score history is stored (F-016). We could compute a rolling average and alert when the team's score drops below a configurable threshold.

**Implementation idea:**
- After each review, compare the new score against the 7-day rolling average.
- If it drops > 20%, show a VS Code warning notification and optionally post to Slack/Teams (reuse F-018 webhooks).
- Add a trend sparkline to the Analytics Dashboard.

**Complexity:** Medium | **Impact:** Medium

---

### Theme 3 — Team Collaboration

#### F-040 · Share Review as Permalink (Short Link via Gist)
**Rationale:** Currently users can export a review but sharing it requires manually sending a file. Publishing to a GitHub Gist (the token is already configured) and copying a short link would be one click.

**Implementation idea:**
- Add a "Share 🔗" button in the review panel toolbar.
- Upload the review markdown to a private/public Gist (user preference).
- Copy the Gist URL to clipboard and show a toast.

**Complexity:** Low | **Impact:** High

---

#### F-041 · Team Review Scorecard (Aggregate Scores Across Team)
**Rationale:** Individual scores exist. Surfacing an aggregated view of the team's review health (avg score per author, most common finding categories) would help tech leads identify coaching opportunities.

**Implementation idea:**
- Store per-author score summaries in a shared JSON file committed to the repo (opt-in).
- Render a leaderboard in the Analytics Dashboard panel (reuse existing chart infrastructure).

**Complexity:** High | **Impact:** Medium

---



#### F-043 · Dependency Review (package.json / requirements.txt diff)
**Rationale:** Adding or upgrading packages is a high-risk activity. When the staged diff touches dependency files, the extension could fetch CVE data for added/bumped packages and include it in the review.

**Implementation idea:**
- Detect changes to `package.json`, `requirements.txt`, `Gemfile`, `go.mod`, etc. in the diff.
- Query the [OSV API](https://api.osv.dev/v1/query) (free, no auth required) for each changed dependency.
- Prepend a "⚠️ Dependency Risk" section to the review output.

**Complexity:** Medium | **Impact:** High

---

## 📅 Suggested Priority Order

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 🔴 P1 | F-042 Secret Scanner | Medium | Very High |
| 🔴 P1 | F-038 Conversational Follow-up | Low | High |
| 🟠 P2 | F-040 Share as Permalink | Low | High |
| 🟠 P2 | F-037 Auto-select Model | Medium | High |
| 🟠 P2 | F-043 Dependency Review | Medium | High |
| 🟡 P3 | F-034 Review Caching | Medium | High |
| 🟡 P3 | F-036 @todo Finder | Low | Medium |
| 🟡 P3 | F-035 File-type Templates | Low | Medium |
| 🟢 P4 | F-039 Trend Alerts | Medium | Medium |
| 🟢 P4 | F-041 Team Scorecard | High | Medium |
