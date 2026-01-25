# Ollama Code Review

Get lightning-fast, expert code reviews and AI-generated commit messages directly in your editor using your local Ollama instance. This extension analyzes your code changes before you commit, helping you catch bugs, improve code quality, and write consistent, informative commit messages, all while keeping your code private on your own machine.

It leverages the power of local large language models to provide feedback on:
- Potential bugs and logical errors
- Performance optimizations
- Security vulnerabilities
- Adherence to best practices
- Code readability and maintainability

## Usage

You can interact with this extension in two primary ways:

**Command Palette**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac), type `Ollama`, and select the desired action from the list.

![Ollama Commands in the Command Palette](images/commands.png)

## Features

**Ollama Code Review** integrates seamlessly into your Git workflow with the following commands:

### 1. Review Staged Changes
- **Command**: `Ollama: Review Staged Changes`
- Get an AI review of all your currently staged changes.
- **Quick Access**: A convenient button `$(comment-discussion)` is also available in the Source Control panel's title bar.
![Review Staged Changes Buttons](images/feature-scm-button.png)

### 2. Generate Commit Message
- **Command**: `Ollama: Generate Commit Message`
- Automatically generates a descriptive, conventional commit message based on your staged changes. The generated message is then populated directly into the Source Control input box.
- **Quick Access**: A `$(sparkle)` icon is available in the Source Control panel's title bar for one-click generation.

![Review and Generate Buttons](images/generate-commit-message.png)

### 3. Suggest Code Improvements
- **Command**: `Ollama: Suggestion`
- Select any block of code in your editor, right-click, and choose this command to get an instant refactoring suggestion from Ollama. The extension presents the suggested code and an explanation in a pop-up, allowing you to apply the changes with a single click.

![Suggest Improvements](images/feature-suggestion.gif)

- Alternatively (currently only JavaScript and TypeScript are supported), you can select a block of code, click on the light bulb icon, and choose "Ollama: Suggest Refactoring"
![Suggest Improvements](images/code-action.gif)

### 4. Review a Commit Range
- **Command**: `Ollama: Review Commit Range`
- Analyze a series of commits. The extension will prompt you to select a starting commit from your history, and it will generate a review for all changes from that point up to `HEAD`.

### 5. Review Changes Between Two Branches
- **Command**: `Ollama: Review Changes Between Two Branches`
- Ideal for pull requests. Compare any two branches or git refs (like tags or commit hashes) to get a comprehensive review of the differences.

### 6. Detailed Review Output
All feedback from Ollama is displayed in a dedicated "Ollama Code Review" output channel, keeping your editor clean. The output includes a list of the files that were analyzed in the review.

![Code Review Output](images/feature-output-panel.png)

### 7. Agent Skills (New!)
- **Command**: `Ollama Code Review: Browse Agent Skills`
- **Command**: `Ollama Code Review: Apply Skill to Review`
- Enhance your code reviews by downloading specialized "skills" from GitHub (defaulting to `vercel-labs/agent-skills`). 
- These skills provide the AI with specific context or specialized rules (e.g., "Performance Expert," "Security Auditor," or "Accessibility Specialist").
- **Workflow**: Browse the library, download a skill, and it will be applied to your next review to provide more targeted feedback.

### 8. Review a Specific Commit
- **Command**: `Ollama Code Review: Review Commit`
- Review any historical commit. You can enter a hash, select from a list of the 50 most recent commits, or trigger it directly from the **Git Graph** extension context menu.

### 9. Detailed Review Output
All feedback from Ollama is displayed in a dedicated "Ollama Code Review" output channel... 
- **New**: The review panel now features a **"Copy Review"** button to quickly copy the entire Markdown feedback to your clipboard for sharing in Pull Requests or Slack.

## Requirements

You must have the following software installed and configured for this extension to work.

1.  **[Ollama](https://ollama.com/)**: The extension requires a running Ollama instance. Please download and install it from the official website.
2.  **An Ollama Model**: You need to have a model pulled to use for the reviews. We recommend a model tuned for coding. You can pull the default model by running:
    ```bash
    ollama pull qwen2.5-coder:14b-instruct-q4_0
    ```
    To verify your setup, you can run the model from your terminal. This command will also pull the model if it doesn't exist and start an interactive session:
    ```bash
    ollama run qwen2.5-coder:14b-instruct-q4_0
    ```
3.  **[Git](https://git-scm.com/)**: Git must be installed and available in your system's PATH.
4.  **VS Code Built-in Git Extension**: This extension must be enabled (it is by default).

## Extension Settings

This extension contributes the following settings to your VS Code `settings.json`:

* `ollama-code-review.model`: Now supports expanded options including `qwen3-coder:480b-cloud`, `glm-4.7:cloud`, or `custom`.
* `ollama-code-review.customModel`: Specify your own model name if you select "custom" in the model setting.
* `ollama-code-review.endpoint`: The API endpoint for your local Ollama instance's generate API.
    * **Type**: `string`
    * **Default**: `"http://localhost:11434/api/generate"`
* `ollama-code-review.skills.defaultRepository`: The GitHub repository to fetch skills from.
    * **Default**: `"vercel-labs/agent-skills"`
* `ollama-code-review.skills.autoApply`: If enabled, the selected skill is automatically applied to all subsequent reviews.
    * **Default**: `true`
* `ollama-code-review.temperature`: The creativity of the AI's response (0.0 for deterministic, 1.0 for very creative).
    * **Type**: `number`
    * **Default**: `0`
* `ollama-code-review.frameworks`: Specify frameworks or libraries (e.g., `React`, `Node.js`) to receive more tailored code reviews aligned with their specific conventions and best practices.
    * **Type**: `array`
    * **Default**: `["React"]`
![Config Frameworks](images/setting-frameworks.png)

You can configure these by opening the Command Palette (`Ctrl+Shift+P`) and searching for `Preferences: Open User Settings (JSON)`.

**Enjoy!**