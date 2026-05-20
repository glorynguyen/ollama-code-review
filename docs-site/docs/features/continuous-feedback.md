# Continuous Feedback

Stay on top of code quality with background monitoring and historical trends.

## Auto-Review on Save

Passive, always-on code quality feedback without interrupting your workflow. When enabled, every file save triggers a silent AI review in the background.

- **How to enable:** Command Palette -> `Ollama Code Review: Toggle Auto-Review on Save`, or set `ollama-code-review.autoReview.enabled: true`.
- **Status Bar:** Look for the `$(eye) Auto` badge in the status bar to see the current status.
- **Workflow:** Findings appear as inline annotations and optional notifications. You can configure the `minSeverity` to only be notified of critical or high issues.

## Review Quality Scoring & Trends

Track the quality of your code over time with a 0–100 score derived from AI findings.

- **Scoring:** Points are deducted based on finding severity (Critical: -20, High: -10, etc.).
- **History Panel:** View your score trends, average quality, and a sortable table of past reviews.
- **Trigger:** Click the quality score in the status bar or use the command `Ollama Code Review: Show Review Quality History`.

## Review Analytics Dashboard

Get a comprehensive, visual overview of your review history.

- **Command:** `Ollama Code Review: Show Review Analytics Dashboard`.
- **Insights:** Distribution of issues by severity and category, most-reviewed files, and model usage statistics.
- **Data Portability:** Export your history as CSV or JSON for external analysis.

## Review Diff Cache

Avoid paying the same latency and API cost twice when you re-run an unchanged review.

- **How it works:** The extension hashes the final review prompt plus model, provider, endpoint, and temperature. If those inputs match a previous review, the stored structured result is reused instantly.
- **What changes the cache key:** Diff content, active profile, selected skills, gathered context, RAG context, model, endpoint, provider, or temperature.
- **Visibility:** Cached reviews show a **Cached** badge in the review panel's **System Info** area, along with when the result was first stored.
- **Configuration:** Use `ollama-code-review.cache.enabled`, `cache.ttlMinutes`, and `cache.maxEntries` to disable caching, shorten the retention window, or cap local storage.

Cached results stay local in VS Code's extension storage and still update findings, annotations, scores, history, and coverage views like a fresh review.

## Review Coverage & Staleness

See which workspace files still need attention without manually digging through review history.

- **Where to find it:** Open the **AI Review** activity bar item and select the **Coverage** view.
- **Groups:** Files are organized into **Never Reviewed**, **Stale**, **Reviewed With Findings**, and **Recently Reviewed**.
- **Actions:** Use the inline actions to review a file or restore its last stored review. The toolbar can refresh the view or copy a Markdown coverage summary.
- **Freshness:** Files become stale after `ollama-code-review.coverage.staleAfterDays` days. The default is `14`.
- **Scope:** Configure the tracked file set with `coverage.includeGlob`, `coverage.excludeGlob`, and `coverage.maxFiles`.

Coverage uses the same local review history as the score and analytics views. It works with staged diff reviews and with file, folder, and selection reviews.

## Findings Management

Efficiently organize and share the results of your reviews.

- **Severity Filter:** Filter the Findings Explorer to focus on specific severities (e.g., only Critical and High).
- **Markdown Export:** Export your findings as a Markdown checklist, grouped by file, to share with your team or track in an issue tracker.
- **Findings Explorer:** A dedicated tree view in the sidebar (AI Review icon) that acts as a "Problems Panel" for AI findings.
