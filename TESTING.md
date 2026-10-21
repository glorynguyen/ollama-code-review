# Test Suite Ownership

The repository uses three test layers. CI runs the root unit, contract, and VS Code integration suites on pull requests. Coverage is collected for unit tests only.

| Test file | Suite | Reason |
| --- | --- | --- |
| `aiActionsValidation.test.ts` | Unit | Pure generated-fix validation; included in `test:unit`. |
| `mcpConfigExports.test.ts` | Contract | Verifies registered MCP resources and tool exports with a fake server. |
| `mcpSembleService.test.ts` | Contract | Exercises the MCP search service boundary using a fake worker process. |
| `mcpSembleTools.test.ts` | Contract | Verifies MCP tool registration and responses with a fake server. |
| `release.test.ts` | Contract | Tests release provider behavior using controlled external-process and request mocks. |
| `batchFix.test.ts` | VS Code integration | Exercises editor/workspace-backed multi-fix behavior. |
| `copySelectedFilesForLLM.test.ts` | VS Code integration | Requires an open VS Code workspace and filesystem fixtures. |
| `extension.test.ts` | VS Code integration | Runs inside the extension host as an activation smoke test. |
| `fileOperations.test.ts` | VS Code integration | Uses workspace paths and VS Code APIs. |
| `ragStorage.integration.test.ts` | VS Code integration | Activates the extension and verifies workspace-scoped storage. |
| `reviewCache.test.ts` | VS Code integration | Exercises persistent extension storage and VS Code configuration. |
| `reviewCoverage.test.ts` | VS Code integration | Exercises workspace scanning and extension storage-backed review state. |
| `testAction.test.ts` | VS Code integration | Covers code action behavior and VS Code test-generation APIs. |

The contract files are listed by `test:contract`. The integration files are listed in `.vscode-test.mjs` and run by `test:extension`. When adding a test, put it in the narrowest suitable suite and update this inventory if it is excluded from unit tests.

## Commands

- `yarn run test:unit` — fast Node tests; coverage is collected here.
- `yarn run test:contract` — MCP and release boundary checks.
- `yarn run test:extension` — bundle and launch the VS Code test host.
- `yarn test` — compile, lint, and run all three suites.
- `yarn run coverage` — unit coverage report.
