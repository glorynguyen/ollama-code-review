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

## Findings Management

Efficiently organize and share the results of your reviews.

- **Severity Filter:** Filter the Findings Explorer to focus on specific severities (e.g., only Critical and High).
- **Markdown Export:** Export your findings as a Markdown checklist, grouped by file, to share with your team or track in an issue tracker.
- **Findings Explorer:** A dedicated tree view in the sidebar (AI Review icon) that acts as a "Problems Panel" for AI findings.
