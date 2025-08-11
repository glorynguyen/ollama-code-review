# Ollama Code Review

Get lightning-fast, expert code reviews directly in your editor using your local Ollama instance. This extension analyzes your code changes before you commit, helping you catch bugs, improve quality, and maintain high standards, all while keeping your code private on your own machine.

It leverages the power of local large language models to provide feedback on:
- Potential bugs and logical errors
- Performance optimizations
- Security vulnerabilities
- Adherence to best practices
- Code readability and maintainability

## Features

**Ollama Code Review** integrates seamlessly into your Git workflow.

### 1. Review Staged Changes

Get an AI review of all your currently staged changes with a single click. A convenient button is added directly to the Source Control panel.

![Review Staged Changes Button](images/feature-scm-button.png)
> The review button `$(comment-discussion)` appears in the Source Control view's title bar.

### 2. Review a Specific Commit Range

Analyze a series of commits. The extension will prompt you to select the starting commit from your history, and it will generate a review for all changes from that point up to `HEAD` (or another ref you specify).

### 3. Review Changes Between Two Branches

Ideal for pull requests. Compare any two branches or git refs (like tags or commit hashes) to get a comprehensive review of the differences.

### 4. Detailed Review Output

All feedback from Ollama is displayed in a dedicated "Ollama Code Review" output channel, keeping your editor clean. The output includes a list of the files that were analyzed in the review.

![Code Review Output](images/feature-output-panel.png)

## Requirements

You must have the following software installed and configured for this extension to work.

1.  **[Ollama](https://ollama.com/)**: The extension requires a running Ollama instance. Please download and install it from the official website.
2.  **An Ollama Model**: You need to have a model pulled to use for the reviews. We recommend a model tuned for coding. You can pull the default model by running:
    ```bash
    ollama pull qwen2.5-coder:14b-instruct-q4_0
    ```
3.  **[Git](https://git-scm.com/)**: Git must be installed and available in your system's PATH.
4.  **VS Code Built-in Git Extension**: This extension must be enabled (it is by default).
5.  **[GitLens Extension](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens)**: This extension is listed as a dependency to enable some context menu integrations.

## Extension Settings

This extension contributes the following settings to your VS Code `settings.json`:

* `ollama-code-review.model`: The Ollama model to use for code reviews.
    * **Type**: `string`
    * **Default**: `"qwen2.5-coder:14b-instruct-q4_0"`
* `ollama-code-review.endpoint`: The API endpoint for your local Ollama instance's generate API.
    * **Type**: `string`
    * **Default**: `"http://localhost:11434/api/generate"`

You can configure these by opening the Command Palette (`Ctrl+Shift+P`) and searching for `Preferences: Open User Settings (JSON)`.

## Known Issues

* The context menu item "Ollama: Review Commit" that appears when right-clicking a commit in the SCM panel or in GitLens views is currently non-functional. It references a command that has been replaced by the more flexible `reviewCommitRange` command. Please use the commands from the Command Palette for now.

## Release Notes

### 0.0.1

Initial release of Ollama Code Review.
* Added feature: Review all staged changes.
* Added feature: Review a range of commits.
* Added feature: Review the diff between two branches.
* Configurable Ollama model and endpoint.

---

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Ctrl+\` on Windows and Linux or `Cmd+\` on macOS).
* Toggle preview (`Shift+Ctrl+V` on Windows and Linux or `Shift+Cmd+V` on macOS).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**