# Project Maintenance Plan

## Goal

Keep dependency installation reproducible, make pull request checks reflect the supported project surfaces, make test exclusions explicit, and keep release documentation accurate.

## Starting Baseline (2026-10-18)

- The root package declares Yarn 1.22.22 and CI installs with `yarn install --frozen-lockfile`.
- Root lockfiles currently include `yarn.lock`, `package-lock.json`, and `pnpm-lock.yaml`. The Chrome extension and docs site also have npm lockfiles; the Chrome extension additionally has a pnpm lockfile.
- `.github/workflows/coverage.yml` runs `yarn run coverage`, which covers `test:unit`; it does not run the root contract or VS Code integration suites, nor the CLI and Chrome extension builds.
- `test:unit` excludes a number of test files explicitly. Contract tests run a subset of those files; other exclusions need clear ownership and validation.
- The extension package and changelog are at `7.1.0`, while `ROADMAP.md` identifies `v3.31.0` as current and is dated 2026-03-11.

## Implementation Status (2026-10-18)

- **Package managers:** documented Yarn for the root and npm for each nested package. Removed the unused root npm/pnpm lockfiles and Chrome pnpm lockfile; added the missing CLI npm lockfile.
- **Pull request CI:** added `.github/workflows/ci.yml` for the full extension test command and the CLI, Chrome extension, and docs site builds. The existing coverage workflow remains focused on unit coverage.
- **Test exclusions:** added `TESTING.md` with suite ownership and reasons. `aiActionsValidation.test.ts` is now included in the unit suite; contract and VS Code integration tests remain assigned to their existing runners.
- **Roadmap:** updated the release metadata and removed implemented features from the proposal list.

Repository branch protection is configured outside the source tree. To require these checks before merge, select the `VS Code extension checks`, `CLI build`, `Chrome extension build`, and `Documentation site build` statuses in the GitHub ruleset.

## Plan

### Phase 1: Decide and document package manager ownership

1. Inventory install, build, and CI commands for the root extension, `packages/cli`, `chrome-extension`, and `docs-site`.
2. Choose the canonical package manager and lockfile for each independently installable package. Prefer the manager already used by that package's CI/build process; if no process exists, decide before deleting lockfiles.
3. Record the decision in the repository documentation and each package's development instructions. Include the exact install command and whether lockfile changes should be committed.
4. Remove only lockfiles confirmed to be unused. Do not regenerate or remove a lockfile merely because another manager is used at the root.
5. Ensure CI uses frozen/locked installation for every package it builds.

**Done when:** every package has one documented authoritative lockfile, CI follows that choice, and no unexplained competing lockfiles remain.

### Phase 2: Establish pull request CI coverage

1. Add a pull request validation workflow that runs root compile, lint, unit tests, contract tests, and VS Code extension tests.
2. Add separate build checks for `packages/cli` and `chrome-extension`, using their documented package managers and lockfiles.
3. Decide whether `docs-site` has a supported build or validation command; add it to CI if it is maintained as a shipped surface.
4. Keep coverage reporting as a distinct job or step, and ensure it does not replace behavioral test suites.
5. Use least-privilege workflow permissions and pin or consistently update GitHub Actions versions.

**Done when:** a pull request exercises every maintained package's required checks, and failures are visible as required status checks. If a check is intentionally omitted, the reason and manual validation path are documented.

### Phase 3: Audit and own test exclusions

1. Create an inventory of every file excluded by `test:unit`, with the reason it is not a unit test and its intended validation layer.
2. Map tests to `unit`, `contract`, or VS Code `integration` suites. Keep each test in at least one routinely executed suite unless it is explicitly marked as manual or temporarily disabled with an owner and follow-up issue.
3. Confirm the existing contract tests cover the MCP configuration, MCP services/tools, and release test files currently assigned to that layer.
4. Assign the remaining excluded tests (including cache, review coverage, RAG integration, file operations, and code-action tests) to a suitable suite, or document why they cannot run in CI.
5. Replace a long, easy-to-miss list of exclusions with explicit test globs or named suite scripts when practical. Keep the suite definitions in sync with CI.

**Done when:** each test file has a known suite and CI execution path, exclusions have documented reasons, and no high-value behavior is silently untested.

### Phase 4: Bring roadmap and release docs up to date

1. Update `ROADMAP.md` current version and last-updated date from the actual release metadata (`package.json` and `CHANGELOG.md`).
2. Compare completed/proposed roadmap items with current commands, settings, and implementation; mark shipped work complete and remove or rewrite stale proposals.
3. Add a lightweight release checklist to the roadmap or contributor docs: version/changelog consistency, package builds, CI checks, and user-facing docs for changed commands/settings.
4. Keep future roadmap edits tied to releases so the status does not fall behind again.

**Done when:** version and date agree with the latest release, and roadmap status distinguishes shipped features from genuinely planned work.

## Suggested Order

1. Complete the package manager inventory and document decisions.
2. Add CI jobs using those decisions, including all existing test suites.
3. Audit test exclusions and adjust suite assignments based on the CI results.
4. Update the roadmap and add release documentation checks.

## Maintenance Cadence

- **Every pull request:** run the required CI matrix; update tests and docs with behavior changes.
- **Monthly:** review dependency update proposals and check that lockfiles remain reproducible.
- **Each release:** verify package versions, changelog, roadmap, package builds, and user-facing settings/commands.
- **Quarterly:** revisit test exclusions, CI runtime, supported Node/VS Code versions, and package manager decisions.

## Risks and Notes

- Keep each package's lockfile decision independent; a monorepo can legitimately use different managers for separate packages, but each choice should be explicit.
- VS Code integration tests may require platform-specific setup or longer runners. If so, keep them in CI with appropriate timeout/platform configuration rather than silently omitting them.
- The working tree may contain user changes to lockfiles. Review and preserve those changes before carrying out the cleanup phase.

## Existing Test Strategy Reference

The following guidance remains applicable when implementing the test and CI phases.

### Test layers

- **Unit:** fast Node tests for pure TypeScript logic, using Mocha and `c8` coverage.
- **VS Code integration:** `vscode-test` for activation, command registration, editor/workspace APIs, code actions, webviews, settings, and SCM flows.
- **Contract/boundary:** focused tests for MCP, CLI, browser-extension messaging, and provider request/response shapes, with mocked dependencies where possible.

### Useful unit-test targets

- `src/diffFilter.ts`
- `src/secretScanner.ts`
- `src/reviewScore.ts`
- `src/modelAdvisor/**`
- `src/context/importParser.ts`
- `src/context/signatureHeuristics.ts`
- `src/contentstack/codeParser.ts`
- `src/contentstack/validator.ts`
- `src/providers/promptFormats.ts`
- Prompt builders, parsers, validators, and pure helpers.

### Coverage approach

Measure coverage on unit-testable code first. Establish a baseline before adding thresholds; then raise line, function, branch, and statement targets gradually. Avoid using coverage percentage as a substitute for useful behavior tests, especially for extension UI and webview glue.

Keep `c8` focused on the Node unit suite. VS Code integration tests run in another process and should be assessed for behavior, not used as the primary coverage percentage.
