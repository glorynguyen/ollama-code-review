# Testing Strategy Plan

## Goal

Improve test confidence and add measurable unit test coverage without making VS Code extension-host tests brittle.

The project should use separate test layers:

- Fast unit tests for pure TypeScript logic with coverage reporting.
- VS Code integration tests for extension-host behavior.
- Contract tests for MCP, CLI, and browser-extension boundaries.

## Recommended Test Layers

### 1. Pure Unit Tests

Use a normal Node test runner plus V8 coverage for code that does not require VS Code APIs.

Recommended tooling:

- `mocha` or `vitest` for test execution.
- `c8` for coverage.
- `source-map-support` if source maps need clearer TypeScript stack traces.

Good unit-test targets:

- `src/diffFilter.ts`
- `src/secretScanner.ts`
- `src/reviewScore.ts`
- `src/modelAdvisor/**`
- `src/context/importParser.ts`
- `src/context/signatureHeuristics.ts`
- `src/contentstack/codeParser.ts`
- `src/contentstack/validator.ts`
- `src/providers/promptFormats.ts`
- prompt builders, parsers, validators, and pure helpers.

Coverage should be measured here first.

### 2. VS Code Integration Tests

Keep `vscode-test` for behavior that needs a real VS Code extension host.

Use integration tests for:

- Extension activation.
- Command registration.
- Code actions.
- Webview smoke tests.
- VS Code workspace and editor APIs.
- Settings and contribution wiring.
- SCM/editor flows that cannot be tested as pure functions.

Do not use these tests as the primary coverage percentage. They are slower, more process-heavy, and harder to instrument reliably.

### 3. Contract And Boundary Tests

Add focused contract tests for boundaries where shape and compatibility matter.

Targets:

- MCP tool registration and responses.
- CLI input/output behavior.
- Chrome extension message handling and MCP client contracts.
- Provider request/response formatting.

These should use mocked dependencies where possible.

## Proposed Scripts

Add scripts like:

```json
{
  "test:unit": "mocha out/test/unit/**/*.test.js",
  "test:extension": "vscode-test",
  "coverage": "c8 --reporter=text --reporter=lcov yarn run test:unit",
  "test": "yarn run compile && yarn run lint && yarn run test:unit && yarn run test:extension"
}
```

The exact glob can be adjusted during migration. One practical structure is:

- `src/test/unit/**/*.test.ts`
- `src/test/extension/**/*.test.ts`
- `src/test/contracts/**/*.test.ts`

## Coverage Targets

Start with realistic thresholds for pure unit-testable code:

- Lines: 60-70%
- Functions: 60-70%
- Branches: 45-60%
- Statements: 60-70%

Then raise over time:

- Lines: 80%+
- Functions: 80%+
- Branches: 70%+
- Statements: 80%+

Avoid forcing high coverage on extension UI/webview glue at the beginning. Prefer useful behavioral tests over fragile coverage chasing.

## Rollout Plan

1. Add `c8` and a dedicated unit-test command.
2. Move pure tests into a unit-test folder or configure the unit runner to include only pure tests.
3. Keep VS Code-dependent tests under an extension/integration folder.
4. Add initial coverage thresholds that reflect the current baseline.
5. Configure CI to run:
   - compile
   - lint
   - unit tests with coverage
   - VS Code integration tests
6. Increase coverage thresholds gradually as more pure modules are tested.
7. Add contract tests for MCP, CLI, and Chrome extension behavior.

## Why Not Only `vscode-test`

`vscode-test` launches VS Code/Electron and runs tests inside the extension host. It is excellent for integration confidence, but it is not designed as a coverage runner. Coverage collection is harder because code runs across multiple processes, and reports need source-map remapping back to TypeScript.

Using `c8` for pure unit tests keeps coverage fast, modern, and reliable, while `vscode-test` continues to verify that the extension works inside VS Code.
