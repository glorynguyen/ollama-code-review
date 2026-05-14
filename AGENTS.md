# Repository Guidelines

## Project Structure & Module Organization

This repository contains a TypeScript VS Code extension for AI-assisted code review. Core extension code lives in `src/`, with modules such as `src/autoReview/`, `src/context/`, and `src/rag/`. The extension entry is `src/extension.ts` and outputs to `dist/`. The headless CLI is in `packages/cli/src/`. The companion Chrome extension is in `chrome-extension/`, with build output in `chrome-extension/dist/`. Static assets are split between `images/` for documentation screenshots, `media/` for webview assets, and `ci-templates/` for pipeline examples. Roadmap and architecture notes live under `docs/`.

## Build, Test, and Development Commands

- `yarn run compile`: type-check and compile with `tsc`.
- `yarn run lint`: run ESLint against `src/`.
- `yarn run build`: run `lint --fix` and compile the extension.
- `yarn run watch`: bundle `src/extension.ts` to `dist/extension.js` in watch mode.
- `yarn test`: run VS Code extension tests via `vscode-test`.
- `yarn run package`: create the VSIX package with a minified bundle.
- `npm --prefix ./chrome-extension run build`: build the Chrome extension.
- `npm --prefix ./packages/cli run build`: compile the CLI package.

## Coding Style & Naming Conventions

Use TypeScript and keep module boundaries narrow. Follow the existing four-space indentation style in `src/`. Terminate statements with semicolons and prefer strict equality. ESLint is configured in `eslint.config.mjs` with `@typescript-eslint`; import names should be `camelCase` or `PascalCase`. Use descriptive filenames that match the module purpose, such as `secretScanner.ts`, `reviewPromptBuilder.ts`, or `dependencyRegistry.ts`.

## Testing Guidelines

Root tests run through `vscode-test`; keep extension behavior tests compatible with the VS Code test harness. Place new tests near the feature they cover or in the shared test support structure when fixtures are needed. Name test files with clear `*.test.ts` or feature-oriented names. Run `yarn test` before submitting extension changes, and at minimum run `yarn run compile` plus `yarn run lint` for TypeScript-only edits.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit style, for example `feat(test-generation): ...`, `docs(rag): ...`, and `chore(release): ...`. Use a concise subject with an optional scope. Pull requests should include a short problem statement, a summary of changes, verification commands, and screenshots or GIFs for UI/webview changes. Link related issues when available and call out changes to extension settings, commands, or packaging.

## Security & Configuration Tips

Do not commit API keys, model credentials, generated VSIX files, or private workspace data. When changing provider settings or secret scanning logic, include a manual verification path in the PR.
