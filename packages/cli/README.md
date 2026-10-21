# Ollama Code Review CLI

The headless CLI runs AI-powered reviews in CI/CD pipelines.

## Development

This package uses npm and its own committed `package-lock.json`. From the repository root:

```sh
npm ci --prefix packages/cli
npm run build --prefix packages/cli
```

The CLI requires Node.js 18 or newer. For usage and options, run `npm exec --prefix packages/cli -- ollama-review --help` after building, or install the published package with `npm install -g @ollama-code-review/cli`.
