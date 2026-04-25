# Git Workflow Integration

Ollama Code Review integrates seamlessly into your Git workflow, providing AI assistance right where you manage your source control.

## Review Staged Changes

This is the most common way to use the extension. It allows you to get a comprehensive AI review of your changes before you commit them.

- **How to trigger:**
    - Click the **chat icon** (`$(comment-discussion)`) in the Source Control panel's title bar.
    - Run the command `Ollama: Review Staged Changes` from the Command Palette.
- **What happens:** The extension extracts the diff of all staged files and sends it to your selected AI model. The feedback appears in a dedicated "Ollama Code Review" panel.

## Generate Commit Message

Stop struggling to write descriptive commit messages. Let the AI do it for you based on the actual changes you've made.

- **How to trigger:**
    - Click the **sparkle icon** (`$(sparkle)`) in the Source Control panel's title bar.
    - Run the command `Ollama: Generate Commit Message` from the Command Palette.
- **Jira Integration:** If a Jira ticket ID is detected in your branch name (e.g., `feature/PROJ-123-login`), it's automatically included in the commit message subject.

## Review Commit Range

Analyze a series of commits in your history.

- **Command:** `Ollama: Review Commit Range`
- **Workflow:** Select a starting commit from your history, and the extension generates a review for all changes from that point up to `HEAD`.

## Review Changes Between Two Branches

Ideal for pre-PR reviews.

- **Command:** `Ollama: Review Changes Between Two Branches`
- **Workflow:** Compare any two branches or git refs (like tags or commit hashes) to get a comprehensive review of the differences.

## Multi-Model Review Comparison

Run the same code review across multiple AI models in parallel and compare results side-by-side.

- **Command:** `Ollama Code Review: Compare Models Review`.
- **Workflow:** Select 2-4 models (local or cloud). The extension displays a comparison table with scores, duration, and findings for each model.

## Pre-Commit Guard

Automatically review staged changes with AI before every commit to catch issues before they enter your history.

- **Enable:** Command Palette -> `Ollama Code Review: Toggle Pre-Commit Guard`.
- **Workflow:** A git pre-commit hook is installed that blocks direct `git commit` calls. Use the `Review & Commit` command to review findings and commit only if the quality meets your configured threshold.
