# Batch & Selection Review

Review any file, folder, or selected text without needing a Git diff — perfect for legacy codebases, third-party code, or files not tracked by Git.

## Review File

Get a comprehensive AI review of an entire file.

- **How to trigger:**
    - Right-click a file in the **Explorer** and select `Ollama Code Review: Review File`.
    - Right-click anywhere in an open **Editor** and select `Ollama Code Review: Review File`.
    - Run the command `Ollama Code Review: Review File` from the Command Palette.
- **Workflow:** The extension reads the full content of the file (up to the `maxFileSizeKb` limit) and generates a review as if the entire file were a new addition.

## Review Folder

Batch-review all files within a specific directory.

- **How to trigger:**
    - Right-click a folder in the **Explorer** and select `Ollama Code Review: Review Folder`.
    - Run the command `Ollama Code Review: Review Folder` from the Command Palette.
- **Workflow:** The extension recursively scans the folder for files matching your `batch.includeGlob` and excluding `batch.excludeGlob`. Each file is analyzed, and the results are aggregated into the review panel.
- **Configuration:** You can fine-tune which files are included or excluded via the `ollama-code-review.batch` settings.

## Review Selection

Focus the AI on a specific snippet of code.

- **How to trigger:**
    - Select a block of code, right-click, and select `Ollama Code Review: Review Selection`.
- **Workflow:** Only the selected text is sent to the AI. This is ideal for getting a quick sanity check on a complex function or a specific logic block without reviewing the entire file.

## Configuration

| Setting | Default | Description |
|---------|-------------|---------|
| `batch.maxFileSizeKb` | `100` | Files larger than this are truncated to avoid hitting AI token limits. |
| `batch.includeGlob` | `**/*.{ts,js,...}` | Glob pattern for file types to include in folder reviews. |
| `batch.excludeGlob` | `**/node_modules/**,...` | Paths to skip during folder reviews. |

---

:::tip
Batch reviews integrate automatically with **Review Quality Scoring** and **Notification Integrations**. After a folder review, you'll see an aggregate quality score and (if configured) receive a summary in Slack, Teams, or Discord.
:::
