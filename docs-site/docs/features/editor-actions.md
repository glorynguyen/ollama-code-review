# Editor & Inline Actions

Get AI assistance directly while you are coding, without switching contexts.

## Suggest Code Improvements

Get instant refactoring suggestions for any block of code.

- **How to trigger:** Select code, right-click, and choose `Ollama: Suggestion`.
- **Workflow:** The extension presents the suggested code and an explanation in a pop-up. You can apply the changes with a single click.

## Inline AI Code Actions

Access powerful actions via the lightbulb menu (`Cmd+.` or `Ctrl+.`):

- **Explain Code:** Get detailed explanations of complex logic or unfamiliar patterns.
- **Generate Tests:** Automatically generate unit tests with framework detection (Jest, Vitest, etc.).
- **Fix Issue:** Get AI-powered fixes for diagnostics or selected code.
- **Add Documentation:** Generate JSDoc/TSDoc comments for functions and classes.

## Inline Edit Mode (AI)

Describe the change you want in plain English and let the AI rewrite the code for you.

- **Trigger:** `Cmd+Shift+K` (Mac) or `Ctrl+Shift+K` (Windows/Linux).
- **Workflow:** Type your request (e.g., "Convert to async/await"), and the AI streams the replacement code side-by-side for you to accept or reject.

## LLM Context Helpers

Quickly prepare code context for external LLMs or understand complex files.

- **Explain File with Imports:** Get an AI explanation of the current file along with its resolved imports.
- **Copy File with Imports:** Copy the current file's source code together with its imported modules to your clipboard.
- **Copy Function with Imports:** Select a function and copy it along with only the imports it uses for a minimal, self-contained snippet.

## Review Feedback Interactions

Interact with the results of a code review directly from the UI.

- **Ask AI About Finding:** Click the chat icon on any finding in the Findings Explorer to ask follow-up questions in the AI sidebar.
- **View Finding Diff:** Click the diff icon on a finding to open a native VS Code diff editor (HEAD vs working copy) scrolled to the relevant line.
- **Quick Fix:** Click the wrench icon in the Findings Explorer or "Quick Fix" in a hover tooltip to generate an AI-powered fix for the issue.

## Review Annotations

See review findings directly in your source code. After a review, findings appear as:
- **Gutter Icons:** Severity-based icons (Error, Warning, Info).
- **Line Highlights:** Subtle background colors on problematic lines.
- **Hover Tooltips:** Detailed information and quick-fix suggestions on hover.
