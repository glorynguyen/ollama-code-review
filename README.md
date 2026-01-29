# Ollama Code Review

Get lightning-fast, expert code reviews and AI-generated commit messages directly in your editor using local Ollama models or cloud AI providers like **Claude (Anthropic)**, **GLM (Z.AI)**, and **Hugging Face**. This extension analyzes your code changes before you commit, helping you catch bugs, improve code quality, and write consistent, informative commit messages.

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

![Agent Skills](images/apply-skills-to-review.gif)

### 8. Review a Specific Commit
- **Command**: `Ollama Code Review: Review Commit`
- Review any historical commit. You can enter a hash, select from a list of the 50 most recent commits, or trigger it directly from the **Git Graph** extension context menu.

### 9. Detailed Review Output
All feedback from Ollama is displayed in a dedicated "Ollama Code Review" output channel... 
- **New**: The review panel now features a **"Copy Review"** button to quickly copy the entire Markdown feedback to your clipboard for sharing in Pull Requests or Slack.

### 10. Dynamic Model Selection & Status Bar
- **Command**: `Ollama Code Review: Select Ollama Model`
- **Quick Access**: Look for the model name (e.g., `ollama: llama3`) in the **Status Bar** at the bottom of your editor. Click it to switch models instantly.
- **Auto-Discovery**: The extension automatically fetches all models currently installed on your local Ollama instance.
- **Cloud Support**: Even if Ollama isn't running locally, you can switch to configured cloud-based models (like Kimi, Qwen, or GLM) or set a custom model name.
- **Smart Fallbacks**: If the connection to the Ollama API fails, the extension gracefully provides a list of cloud and custom options so you're never stuck.

![Model Selection](images/switch-models.gif)

### 11. Claude (Anthropic) Support
Use Anthropic's powerful Claude models for code reviews:
- **Claude Sonnet 4** - Fast, capable model for everyday reviews
- **Claude Opus 4** - Most capable model for complex analysis
- **Claude 3.7 Sonnet** - Balanced performance and quality

To use Claude models:
1. Get your API key from [Anthropic Console](https://console.anthropic.com/)
2. Set your API key in settings: `ollama-code-review.claudeApiKey`
3. Select a Claude model from the status bar or command palette

### 12. GLM (Z.AI/Zhipu) Support
Use GLM models via the Z.AI (BigModel/Zhipu) API:
- **GLM-4.7 Flash** - Fast and free-tier model for code reviews

To use GLM models:
1. Get your API key from [Z.AI Open Platform](https://open.bigmodel.cn/)
2. Set your API key in settings: `ollama-code-review.glmApiKey`
3. Select `glm-4.7-flash` from the model picker

### 13. Hugging Face Support
Use any model from the Hugging Face Inference API:
- Access thousands of open-source models
- Popular coding models: `Qwen/Qwen2.5-Coder-7B-Instruct`, `codellama/CodeLlama-7b-Instruct-hf`, `bigcode/starcoder2-15b`

To use Hugging Face models:
1. Get your API token from [Hugging Face Settings](https://huggingface.co/settings/tokens)
2. Set your token in settings: `ollama-code-review.hfApiKey`
3. Configure the model name: `ollama-code-review.hfModel`
4. Select `huggingface` from the model picker

### 14. Smart Diff Filtering
Reduce noise in your code reviews by filtering out irrelevant changes:
- **Ignore paths**: Skip `node_modules`, lock files, build outputs
- **Ignore patterns**: Exclude minified files, source maps, generated code
- **Large file warnings**: Get notified when files exceed a line threshold
- **Formatting-only detection**: Optionally skip files with only whitespace changes

Configure in settings under `ollama-code-review.diffFilter`.

---

## Requirements

You must have the following software installed and configured for this extension to work.

### For Local Ollama Models
1.  **[Ollama](https://ollama.com/)**: Download and install from the official website.
2.  **An Ollama Model**: Pull a model tuned for coding:
    ```bash
    ollama pull kimi-k2.5:cloud
    ```

### For Claude Models (Alternative)
1.  **Anthropic API Key**: Get one from [console.anthropic.com](https://console.anthropic.com/)
2.  **Configure the key** in VS Code settings: `ollama-code-review.claudeApiKey`

### For GLM Models (Alternative)
1.  **Z.AI API Key**: Get one from [open.bigmodel.cn](https://open.bigmodel.cn/)
2.  **Configure the key** in VS Code settings: `ollama-code-review.glmApiKey`

### For Hugging Face Models (Alternative)
1.  **Hugging Face API Token**: Get one from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2.  **Configure the token** in VS Code settings: `ollama-code-review.hfApiKey`
3.  **Set the model name** in VS Code settings: `ollama-code-review.hfModel`

### General Requirements
1.  **[Git](https://git-scm.com/)**: Git must be installed and available in your system's PATH.
2.  **VS Code Built-in Git Extension**: This extension must be enabled (it is by default).

## Extension Settings

This extension contributes the following settings to your VS Code `settings.json`:

* `ollama-code-review.model`: Supports local Ollama models, cloud models (`kimi-k2.5:cloud`, `qwen3-coder:480b-cloud`, `glm-4.7:cloud`), Claude models (`claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-3-7-sonnet-20250219`), GLM models (`glm-4.7-flash`), Hugging Face (`huggingface`), or `custom`.
* `ollama-code-review.customModel`: Specify your own model name if you select "custom" in the model setting.
* `ollama-code-review.claudeApiKey`: Your Anthropic API key for Claude models.
* `ollama-code-review.glmApiKey`: Your Z.AI (BigModel/Zhipu) API key for GLM models.
* `ollama-code-review.hfApiKey`: Your Hugging Face API token for using Hugging Face models.
* `ollama-code-review.hfModel`: The Hugging Face model to use (default: `Qwen/Qwen2.5-Coder-7B-Instruct`).
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
* `ollama-code-review.diffFilter`: Configure diff filtering to exclude noise from reviews.
    * `ignorePaths`: Glob patterns for paths to ignore (default: `node_modules`, lock files, `dist`, `build`, `out`)
    * `ignorePatterns`: File name patterns to ignore (default: `*.min.js`, `*.min.css`, `*.map`, `*.generated.*`)
    * `maxFileLines`: Warn when a file has more changed lines than this (default: `500`)
    * `ignoreFormattingOnly`: Skip files with only whitespace/formatting changes (default: `false`)

You can configure these by opening the Command Palette (`Ctrl+Shift+P`) and searching for `Preferences: Open User Settings (JSON)`.

**Enjoy!**