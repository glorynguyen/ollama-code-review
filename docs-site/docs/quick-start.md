# Quick Start

Get up and running with Ollama Code Review in minutes.

## Requirements

Before installing, ensure you meet the following requirements:

1.  **VS Code 1.102.0 or later** — [Download the latest version](https://code.visualstudio.com/).
2.  **Git**: Installed and available in your system's PATH.

## 1. Installation

Install the **Ollama Code Review** extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VinhNguyen-Vincent.ollama-code-review).

## 2. Interactive Setup Guide

On first install, the extension will automatically show an **interactive Setup Guide**. This guide walks you through:

1.  **Choosing a Provider:** Select between local Ollama or various cloud providers.
2.  **Configuration:** Enter API keys or pull recommended local models.
3.  **First Review:** Run your first code review to see the extension in action.

You can reopen this guide at any time via the Command Palette: `Ollama Code Review: Open Setup Guide`.

## 3. Configure a Provider

Depending on your preference, follow the setup for either local or cloud models:

### Option A: Local Ollama (Privacy Focused)
1.  Install [Ollama](https://ollama.com/).
2.  Open your terminal and pull a recommended model:
    ```bash
    ollama pull qwen2.5-coder:7b
    ```
3.  The extension will auto-detect your local Ollama instance.

### Option B: Cloud Models (Highest Reasoning)
1.  Obtain an API key from your preferred provider (e.g., [Google AI Studio](https://aistudio.google.com/) for Gemini, [Anthropic](https://console.anthropic.com/) for Claude).
2.  Open VS Code Settings (`Cmd+,`) and search for `Ollama Code Review`.
3.  Enter your API key in the corresponding field (e.g., `Gemini Api Key`).

## 4. Your First Review

1.  Stage some changes in your Git repository.
2.  Open the **Source Control** panel.
3.  Click the **Ollama: Review Staged Changes** button (chat icon) in the title bar.
4.  Wait a few seconds for the AI feedback to appear in the "Ollama Code Review" panel!

## Useful Commands

Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux) and type `Ollama` to see all available commands:

- `Ollama: Review Staged Changes`
- `Ollama: Generate Commit Message`
- `Ollama: Suggestion` (right-click on selected code)
- `Ollama Code Review: Select AI Model`
