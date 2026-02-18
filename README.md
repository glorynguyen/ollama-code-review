# Ollama Code Review

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/VinhNguyen-Vincent.ollama-code-review?style=for-the-badge&label=VS%20Marketplace&color=007ACC&logo=visual-studio-code&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=VinhNguyen-Vincent.ollama-code-review)
[![VS Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/VinhNguyen-Vincent.ollama-code-review?style=for-the-badge&label=Installs&color=4B9CD3&logo=visual-studio-code&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=VinhNguyen-Vincent.ollama-code-review)
[![GitHub Release](https://img.shields.io/github/v/release/glorynguyen/ollama-code-review?style=for-the-badge&logo=github&logoColor=white)](https://github.com/glorynguyen/ollama-code-review/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/glorynguyen/ollama-code-review/release.yml?style=for-the-badge&label=Build&logo=github-actions&logoColor=white)](https://github.com/glorynguyen/ollama-code-review/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/github/license/glorynguyen/ollama-code-review?style=for-the-badge&color=yellow)](https://github.com/glorynguyen/ollama-code-review/blob/main/LICENSE.md)
[![GitHub Stars](https://img.shields.io/github/stars/glorynguyen/ollama-code-review?style=for-the-badge&logo=github&logoColor=white)](https://github.com/glorynguyen/ollama-code-review/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/glorynguyen/ollama-code-review?style=for-the-badge&logo=github&logoColor=white)](https://github.com/glorynguyen/ollama-code-review/forks)
[![GitHub Issues](https://img.shields.io/github/issues/glorynguyen/ollama-code-review?style=for-the-badge&logo=github&logoColor=white)](https://github.com/glorynguyen/ollama-code-review/issues)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-1.102%2B-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white)](https://code.visualstudio.com/)

Get lightning-fast, expert code reviews and AI-generated commit messages directly in your editor using local Ollama models, cloud AI providers like **Claude (Anthropic)**, **Gemini (Google AI)**, **Mistral AI**, **MiniMax**, **GLM (Z.AI)**, and **Hugging Face**, or **any OpenAI-compatible server** such as LM Studio, vLLM, LocalAI, Groq, and OpenRouter. This extension analyzes your code changes before you commit, helping you catch bugs, improve code quality, and write consistent, informative commit messages.

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

### 4. Inline AI Code Actions
Select any code in your editor and access powerful AI-powered actions via the lightbulb menu or `Ctrl+.` (`Cmd+.` on Mac):

- **Explain Code**: Get detailed explanations of selected code displayed in a preview panel. Understand complex logic, algorithms, or unfamiliar code patterns.
- **Generate Tests**: Automatically generate unit tests for your code with framework detection (Jest, Mocha, Vitest, etc.). Preview tests before creating the test file.
- **Fix Issue**: Get AI-powered fixes for diagnostics or selected code. View changes in a diff preview before applying them with one click.
- **Add Documentation**: Generate JSDoc/TSDoc comments for functions, classes, and methods. Preview documentation before inserting it into your code.

Each action opens a dedicated preview panel where you can review the AI's output before applying changes to your code.

Supported languages: JavaScript, TypeScript, JSX, TSX, and **PHP**.

### 5. Review a Commit Range
- **Command**: `Ollama: Review Commit Range`
- Analyze a series of commits. The extension will prompt you to select a starting commit from your history, and it will generate a review for all changes from that point up to `HEAD`.

### 6. Review Changes Between Two Branches
- **Command**: `Ollama: Review Changes Between Two Branches`
- Ideal for pull requests. Compare any two branches or git refs (like tags or commit hashes) to get a comprehensive review of the differences.

### 7. Detailed Review Output
All feedback from Ollama is displayed in a dedicated "Ollama Code Review" output channel, keeping your editor clean. The output includes a list of the files that were analyzed in the review.

![Code Review Output](images/feature-output-panel.png)

### 8. Agent Skills (Multi-Skill Support)
- **Command**: `Ollama Code Review: Browse Agent Skills`
- **Command**: `Ollama Code Review: Apply Skills to Review`
- **Command**: `Ollama Code Review: Clear Selected Skills`
- Enhance your code reviews by downloading specialized "skills" from GitHub (defaulting to `vercel-labs/agent-skills`).
- These skills provide the AI with specific context or specialized rules (e.g., "Performance Expert," "Security Auditor," or "Accessibility Specialist").
- **Multi-Skill Selection**: Select multiple skills simultaneously to combine their expertise in a single review. For example, apply both "Security Auditor" and "Performance Expert" skills together.
- **Workflow**:
  1. Browse the library and download skills you want to use
  2. Use "Apply Skills to Review" to select one or more skills (previously selected skills are pre-checked)
  3. Run your code review - all selected skills will be applied
  4. Use "Clear Selected Skills" to quickly deselect all skills

![Agent Skills](images/apply-skills-to-review.gif)

### 9. Review a Specific Commit
- **Command**: `Ollama Code Review: Review Commit`
- Review any historical commit. You can enter a hash, select from a list of the 50 most recent commits, or trigger it directly from the **Git Graph** extension context menu.

### 10. Detailed Review Output
All feedback from Ollama is displayed in a dedicated "Ollama Code Review" output channel... 
- **New**: The review panel now features a **"Copy Review"** button to quickly copy the entire Markdown feedback to your clipboard for sharing in Pull Requests or Slack.

### 11. Dynamic Model Selection & Status Bar
- **Command**: `Ollama Code Review: Select Ollama Model`
- **Quick Access**: Look for the model name (e.g., `ollama: llama3`) in the **Status Bar** at the bottom of your editor. Click it to switch models instantly.
- **Auto-Discovery**: The extension automatically fetches all models currently installed on your local Ollama instance.
- **Cloud Support**: Even if Ollama isn't running locally, you can switch to configured cloud-based models (like Kimi, Qwen, or GLM) or set a custom model name.
- **Smart Fallbacks**: If the connection to the Ollama API fails, the extension gracefully provides a list of cloud and custom options so you're never stuck.

![Model Selection](images/switch-models.gif)

### 12. Claude (Anthropic) Support
Use Anthropic's powerful Claude models for code reviews:
- **Claude Sonnet 4** - Fast, capable model for everyday reviews
- **Claude Opus 4** - Most capable model for complex analysis
- **Claude 3.7 Sonnet** - Balanced performance and quality

To use Claude models:
1. Get your API key from [Anthropic Console](https://console.anthropic.com/)
2. Set your API key in settings: `ollama-code-review.claudeApiKey`
3. Select a Claude model from the status bar or command palette

### 13. GLM (Z.AI/Zhipu) Support
Use GLM models via the Z.AI (BigModel/Zhipu) API:
- **GLM-4.7 Flash** - Fast and free-tier model for code reviews

To use GLM models:
1. Get your API key from [Z.AI Open Platform](https://open.bigmodel.cn/)
2. Set your API key in settings: `ollama-code-review.glmApiKey`
3. Select `glm-4.7-flash` from the model picker

### 14. Gemini (Google AI) Support
Use Google's Gemini models via the free Google AI Studio API:
- **Gemini 2.5 Flash** - Fast model with 250 requests/day free tier (15 RPM)
- **Gemini 2.5 Pro** - More capable model with 100 requests/day free tier (5 RPM)
- Both models feature a massive 1-million-token context window

To use Gemini models:
1. Get your API key from [Google AI Studio](https://aistudio.google.com/) (no credit card required)
2. Set your API key in settings: `ollama-code-review.geminiApiKey`
3. Select `gemini-2.5-flash` or `gemini-2.5-pro` from the model picker

### 15. Mistral AI Support
Use Mistral AI's powerful models for code reviews:
- **Mistral Large** - Most capable model for complex analysis
- **Mistral Small** - Fast and efficient for everyday reviews
- **Codestral** - Specifically optimized for code generation and review

To use Mistral models:
1. Get your API key from [Mistral Console](https://console.mistral.ai/)
2. Set your API key in settings: `ollama-code-review.mistralApiKey`
3. Select `mistral-large-latest`, `mistral-small-latest`, or `codestral-latest` from the model picker

### 16. MiniMax Support
Use MiniMax's models for code reviews:
- **MiniMax M2.5** - Powerful model for code review and analysis

To use MiniMax models:
1. Get your API key from [MiniMax Platform](https://platform.minimaxi.com/)
2. Set your API key in settings: `ollama-code-review.minimaxApiKey`
3. Select `MiniMax-M2.5` from the model picker

### 17. Hugging Face Support
Use any model from the Hugging Face Inference API:
- Access thousands of open-source models
- **Smart Model Picker**: When selecting `huggingface`, a submenu appears with:
  - **Recently Used**: Your last 5 HF models for quick switching
  - **Popular Models**: Curated list of coding models (customizable)
  - **Custom**: Enter any HF model identifier manually
- This makes it easy to quickly switch models when one is busy or returns errors (401/503)

To use Hugging Face models:
1. Get your API token from [Hugging Face Settings](https://huggingface.co/settings/tokens)
2. Set your token in settings: `ollama-code-review.hfApiKey`
3. Select `huggingface` from the model picker → choose from recent, popular, or enter custom
4. (Optional) Customize the popular models list via `ollama-code-review.hfPopularModels`

**Default Popular Models:**
- `Qwen/Qwen2.5-Coder-7B-Instruct`
- `Qwen/Qwen2.5-Coder-32B-Instruct`
- `mistralai/Mistral-7B-Instruct-v0.3`
- `codellama/CodeLlama-7b-Instruct-hf`
- `bigcode/starcoder2-15b`
- `meta-llama/Llama-3.1-8B-Instruct`
- `deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct`

### 18. OpenAI-Compatible Server Support
Use any server that exposes an OpenAI-compatible `/v1/chat/completions` endpoint — no individual integration required:

| Server | Type | Default Endpoint |
|--------|------|-----------------|
| **LM Studio** | Local | `http://localhost:1234/v1` |
| **LocalAI** | Local | `http://localhost:8080/v1` |
| **vLLM** | Local | `http://localhost:8000/v1` |
| **Groq** | Cloud | `https://api.groq.com/openai/v1` |
| **OpenRouter** | Cloud | `https://openrouter.ai/api/v1` |
| **Together AI** | Cloud | `https://api.together.xyz/v1` |
| Any other OpenAI-compatible API | — | Custom URL |

**Smart Setup Picker**: When you select `openai-compatible` from the model picker, a guided flow appears:
1. Choose from popular server presets or enter a custom endpoint URL
2. Enter the model name (e.g., `lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF`, `llama3`, `gpt-4o`)
3. Settings are saved automatically — no manual JSON editing required

To use an OpenAI-compatible server:
1. Start your server (e.g., open LM Studio and load a model)
2. Select `openai-compatible` from the status bar model picker
3. Pick your server preset or enter a custom endpoint
4. Enter the model name and you're ready to go

**Optional API key**: Leave `ollama-code-review.openaiCompatible.apiKey` empty for local servers that don't require authentication (LM Studio, LocalAI, vLLM). Set it for cloud services like Groq or OpenRouter.

### 19. Custom Prompt Templates
Customize the AI prompts used for code reviews and commit message generation:
- **Review Prompt**: Override the default code review prompt with your own template
- **Commit Message Prompt**: Customize how commit messages are generated

Use variable placeholders that get replaced at runtime:
- **Review**: `${code}` (the diff), `${frameworks}` (selected frameworks), `${skills}` (active agent skills), `${profile}` (active review profile context)
- **Commit Message**: `${diff}` (staged diff), `${draftMessage}` (developer's draft)

Configure via (in order of increasing priority):
- `ollama-code-review.prompt.review` — multiline text area in Settings UI
- `ollama-code-review.prompt.commitMessage` — multiline text area in Settings UI
- `.ollama-review.yaml` at the workspace root — highest priority, overrides all other sources (see section 19)

> **Note:** If your custom review prompt omits `${skills}`, active agent skills are automatically appended. Likewise, if `${profile}` is omitted, the active review profile context is automatically appended.

### 20. Project Config File (.ollama-review.yaml)
Share consistent AI review settings across your whole team by adding a `.ollama-review.yaml` file to the root of your repository. Settings in this file override both the built-in defaults and your VS Code `settings.json`, making it easy for everyone on the team to use the same prompts, frameworks, and diff filters without individual configuration.

- **Command**: `Ollama Code Review: Reload Project Config (.ollama-review.yaml)` — manually refresh the cached config after editing the file (usually not needed, as the extension auto-detects changes).

**Example `.ollama-review.yaml`:**

```yaml
# Custom review prompt (overrides VS Code settings)
prompt:
  review: |
    Review the following code diff for our React + TypeScript project.
    Focus on type safety, React best practices, and accessibility.
    Diff:
    ${code}
  commitMessage: |
    Generate a Conventional Commits message for this diff:
    ${diff}

# Frameworks list (overrides ollama-code-review.frameworks setting)
frameworks:
  - React
  - TypeScript
  - Node.js

# Diff filter overrides
diffFilter:
  ignorePaths:
    - "**/generated/**"
  ignoreFormattingOnly: true
```

The extension automatically watches `.ollama-review.yaml` for changes (create, edit, delete) and reloads the config without requiring a VS Code restart.

### 21. Smart Diff Filtering
Reduce noise in your code reviews by filtering out irrelevant changes:
- **Ignore paths**: Skip `node_modules`, lock files, build outputs
- **Ignore patterns**: Exclude minified files, source maps, generated code
- **Large file warnings**: Get notified when files exceed a line threshold
- **Formatting-only detection**: Optionally skip files with only whitespace changes

Configure in settings under `ollama-code-review.diffFilter`.

### 22. Review Profiles & Presets
- **Command**: `Ollama Code Review: Select Review Profile`
- Focus the AI on what matters most by switching between six built-in review profiles — or create your own:

| Profile | Focus |
|---------|-------|
| **General** (default) | Balanced review across all dimensions |
| **Security** | Authentication, injection vulnerabilities, secrets exposure |
| **Performance** | Algorithmic complexity, memory leaks, caching opportunities |
| **Accessibility** | ARIA attributes, keyboard navigation, screen reader support |
| **Educational** | Explains *why* changes are good/bad — great for learning |
| **Strict** | High-severity findings only, zero tolerance for issues |

- **Status Bar**: A shield icon next to the model indicator shows the active profile. Click it to switch instantly.
- **Custom Profiles**: Define your own profiles in `ollama-code-review.customProfiles` or via the profile picker ("Create new profile...").
- **Prompt Integration**: The active profile context is injected via the `${profile}` template variable. If your custom prompt template omits `${profile}`, it is automatically appended.
- **Persistence**: The selected profile is remembered across VS Code sessions.

### 23. Export Review Results
After a review completes, use the toolbar buttons at the top of the review panel to share or save results:

- **Copy to Clipboard**: Instantly copies the raw Markdown review to your clipboard.
- **Save as Markdown**: Opens a system save dialog and writes the review as a `.md` file.
- **PR Description**: Wraps the review with a model attribution header and copies it to your clipboard — ready to paste into a Pull Request description.
- **Create GitHub Gist**: Posts a private Gist containing the review. Requires a GitHub Personal Access Token with the `gist` scope configured in settings (`ollama-code-review.github.gistToken`). After creation you can open the Gist in your browser or copy its URL.

### 24. GitHub PR Integration
Review GitHub Pull Requests directly from VS Code and post AI-generated reviews as PR comments:

- **Command**: `Ollama Code Review: Review GitHub PR`
  - Enter a PR URL (e.g., `https://github.com/owner/repo/pull/123`), a shorthand like `#123` or `owner/repo#123`, or a PR number (requires the repo to be open in your workspace).
  - Fetches the PR diff from GitHub and runs it through the selected AI model.
  - The review opens in the standard review panel with full chat and export support.

- **Command**: `Ollama Code Review: Post Review to GitHub PR`
  - After reviewing, post the AI output directly to the PR as a GitHub comment.
  - Choose between three comment styles via the `ollama-code-review.github.commentStyle` setting:
    - **`summary`** _(default)_ — One top-level PR comment with the full review.
    - **`inline`** — Attempts to place comments on specific changed lines.
    - **`both`** — Posts a summary comment and inline comments.

**GitHub Authentication** — The extension tries to authenticate in this order:
1. `gh` CLI (if installed and authenticated via `gh auth login`)
2. VS Code built-in GitHub session (sign in via VS Code accounts menu)
3. Stored `ollama-code-review.github.token` setting (Personal Access Token)

To configure via token:
1. Get a GitHub Personal Access Token with the **`repo`** scope from [github.com/settings/tokens](https://github.com/settings/tokens)
2. Set your token in settings: `ollama-code-review.github.token`
3. (Optional) Configure `ollama-code-review.github.commentStyle` to control how reviews are posted

> **Note:** `ollama-code-review.github.gistToken` is used for creating Gists; if not set, the extension falls back to `ollama-code-review.github.token` for Gist creation as well.

### 25. MCP Server for Claude Desktop
Use the code review functionality directly in Claude Desktop without copy-pasting diffs. The MCP server is available as a separate project:

**Repository:** [gitsage](https://github.com/glorynguyen/gitsage)

Features include:
- **16 Tools Available**: Review staged changes, commits, branches, generate commit messages, explain code, and more
- **Skills Support**: Apply agent skills to enhance reviews
- **Git Integration**: Full access to repository status, commits, and branches

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

### For Gemini Models (Alternative)
1.  **Google AI Studio API Key**: Get one from [aistudio.google.com](https://aistudio.google.com/) (free, no credit card required)
2.  **Configure the key** in VS Code settings: `ollama-code-review.geminiApiKey`

### For Mistral Models (Alternative)
1.  **Mistral AI API Key**: Get one from [console.mistral.ai](https://console.mistral.ai/)
2.  **Configure the key** in VS Code settings: `ollama-code-review.mistralApiKey`

### For MiniMax Models (Alternative)
1.  **MiniMax API Key**: Get one from [platform.minimaxi.com](https://platform.minimaxi.com/)
2.  **Configure the key** in VS Code settings: `ollama-code-review.minimaxApiKey`

### For Hugging Face Models (Alternative)
1.  **Hugging Face API Token**: Get one from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2.  **Configure the token** in VS Code settings: `ollama-code-review.hfApiKey`
3.  **Select a model** from the model picker (recent, popular, or custom) - no need to configure `hfModel` manually!

### For OpenAI-Compatible Servers (Alternative)
1.  **Start your server** — e.g., open LM Studio and load a model, or start vLLM/LocalAI
2.  **Select `openai-compatible`** from the status bar model picker
3.  **Follow the setup picker** — choose a preset or enter a custom endpoint, then enter the model name
4.  For cloud services (Groq, OpenRouter, etc.): configure `ollama-code-review.openaiCompatible.apiKey` with your API key
5.  No API key needed for local servers (LM Studio, LocalAI, vLLM)

### General Requirements
1.  **[Git](https://git-scm.com/)**: Git must be installed and available in your system's PATH.
2.  **VS Code Built-in Git Extension**: This extension must be enabled (it is by default).

## Extension Settings

This extension contributes the following settings to your VS Code `settings.json`:

* `ollama-code-review.model`: Supports local Ollama models, cloud models (`kimi-k2.5:cloud`, `qwen3-coder:480b-cloud`, `glm-4.7:cloud`), Claude models (`claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-3-7-sonnet-20250219`), Gemini models (`gemini-2.5-flash`, `gemini-2.5-pro`), Mistral models (`mistral-large-latest`, `mistral-small-latest`, `codestral-latest`), MiniMax models (`MiniMax-M2.5`), GLM models (`glm-4.7-flash`), Hugging Face (`huggingface`), any OpenAI-compatible server (`openai-compatible`), or `custom`.
* `ollama-code-review.customModel`: Specify your own model name if you select "custom" in the model setting.
* `ollama-code-review.claudeApiKey`: Your Anthropic API key for Claude models.
* `ollama-code-review.glmApiKey`: Your Z.AI (BigModel/Zhipu) API key for GLM models.
* `ollama-code-review.hfApiKey`: Your Hugging Face API token for using Hugging Face models.
* `ollama-code-review.hfModel`: The Hugging Face model to use (default: `Qwen/Qwen2.5-Coder-7B-Instruct`).
* `ollama-code-review.hfPopularModels`: Customize the list of popular Hugging Face models shown in the model picker submenu.
* `ollama-code-review.geminiApiKey`: Your Google AI Studio API key for Gemini models.
* `ollama-code-review.mistralApiKey`: Your Mistral AI API key for Mistral models.
* `ollama-code-review.minimaxApiKey`: Your MiniMax API key for MiniMax models.
* `ollama-code-review.openaiCompatible.endpoint`: Base URL for any OpenAI-compatible server.
    * **Default**: `"http://localhost:1234/v1"` (LM Studio default)
    * Examples: `http://localhost:8080/v1` (LocalAI), `https://api.groq.com/openai/v1` (Groq), `https://openrouter.ai/api/v1` (OpenRouter)
* `ollama-code-review.openaiCompatible.apiKey`: API key for the OpenAI-compatible endpoint. Leave empty for local servers that don't require authentication.
* `ollama-code-review.openaiCompatible.model`: The model name to request from the endpoint (e.g., `lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF`, `llama3`, `gpt-4o`).
* `ollama-code-review.endpoint`: The API endpoint for your local Ollama instance's generate API.
    * **Type**: `string`
    * **Default**: `"http://localhost:11434/api/generate"`
* `ollama-code-review.skills.defaultRepository`: The GitHub repository to fetch skills from.
    * **Default**: `"vercel-labs/agent-skills"`
* `ollama-code-review.skills.additionalRepositories`: Additional GitHub repositories to fetch skills from (combined with default).
    * **Type**: `array`
    * **Default**: `[]`
* `ollama-code-review.skills.autoApply`: If enabled, selected skills are automatically applied to all subsequent reviews.
    * **Default**: `true`
    * **Note**: Multiple skills can be selected and will be combined in reviews.
* `ollama-code-review.temperature`: The creativity of the AI's response (0.0 for deterministic, 1.0 for very creative).
    * **Type**: `number`
    * **Default**: `0`
* `ollama-code-review.frameworks`: Specify frameworks or libraries (e.g., `React`, `Node.js`) to receive more tailored code reviews aligned with their specific conventions and best practices.
    * **Type**: `array`
    * **Default**: `["React"]`
![Config Frameworks](images/setting-frameworks.png)
* `ollama-code-review.prompt.review`: Custom prompt template for code reviews. Use `${code}`, `${frameworks}`, `${skills}`, and `${profile}` as placeholders. Leave empty to use the built-in default. Can be overridden by `.ollama-review.yaml` at workspace root.
    * **Type**: `string` (multiline)
* `ollama-code-review.prompt.commitMessage`: Custom prompt template for commit message generation. Use `${diff}` and `${draftMessage}` as placeholders. Leave empty to use the built-in default. Can be overridden by `.ollama-review.yaml` at workspace root.
    * **Type**: `string` (multiline)
* `ollama-code-review.diffFilter`: Configure diff filtering to exclude noise from reviews. Can be partially overridden by `.ollama-review.yaml` at workspace root (YAML values merged on top of settings).
    * `ignorePaths`: Glob patterns for paths to ignore (default: `node_modules`, lock files, `dist`, `build`, `out`, `.next`, `coverage`)
    * `ignorePatterns`: File name patterns to ignore (default: `*.min.js`, `*.min.css`, `*.map`, `*.generated.*`, `*.g.ts`, `*.d.ts.map`)
    * `maxFileLines`: Warn when a file has more changed lines than this (default: `500`)
    * `ignoreFormattingOnly`: Skip files with only whitespace/formatting changes (default: `false`)
* `ollama-code-review.customProfiles`: Define custom review profiles as a JSON array. Each object supports `name`, `focusAreas` (array of strings), `severity` (`low` | `medium` | `high`), and an optional `description`.
* `ollama-code-review.github.token`: GitHub Personal Access Token with the **`repo`** scope, used for reviewing GitHub PRs and posting review comments. Get one at [github.com/settings/tokens](https://github.com/settings/tokens).
* `ollama-code-review.github.commentStyle`: Controls how AI reviews are posted to GitHub PRs.
    * `summary` _(default)_ — A single top-level PR comment with the full review.
    * `inline` — Comments placed on specific changed lines.
    * `both` — Summary comment plus inline comments.
* `ollama-code-review.github.gistToken`: GitHub Personal Access Token with the `gist` scope, used to create private Gists from review results. Get one at [github.com/settings/tokens](https://github.com/settings/tokens).

You can configure these by opening the Command Palette (`Ctrl+Shift+P`) and searching for `Preferences: Open User Settings (JSON)`.

**Enjoy!**