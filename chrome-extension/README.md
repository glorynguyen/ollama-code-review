# OCR Browser Review

This folder contains a companion Chrome extension for `ollama-code-review`.

It is intentionally kept as a separate subproject so:

- it lives in the same repository as the VS Code extension
- it can reuse the local MCP server exposed by the VS Code extension
- it is not bundled into `dist/extension.js`
- it is excluded from the VS Code `.vsix` package

## What it does

- Detects GitHub pull request pages and GitLab merge request pages
- Adds a `Review with AI` button
- Calls the local MCP server on `http://127.0.0.1:19840/mcp`
- Uses WebLLM + WebGPU in the browser to generate the review locally

## Build

Install dependencies first:

```bash
cd chrome-extension
npm install
```

Then either build from the repo root:

```bash
npm run build:chrome-extension
```

Or build directly from this folder:

```bash
npm run build
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `chrome-extension/` folder

## Required VS Code settings

- Enable `ollama-code-review.mcp.enabled`
- Optionally set `ollama-code-review.mcp.authToken`
- If you set a token, enter the same token in the browser overlay

## Notes

- The current browser extension uses `get_workspace_repos` and `get_branch_diff`
- The repository must already be open in VS Code
- The local repository should already have the relevant refs fetched
