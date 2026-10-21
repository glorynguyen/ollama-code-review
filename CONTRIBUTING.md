# Contributing

## Package managers

Use the package manager and lockfile belonging to the package you are changing. Do not run a package manager from the repository root against a nested package.

| Package | Package manager | Authoritative lockfile | Install command |
| --- | --- | --- | --- |
| VS Code extension (repository root) | Yarn 1.22.22 | `yarn.lock` | `yarn install --frozen-lockfile` |
| Headless CLI (`packages/cli`) | npm | `packages/cli/package-lock.json` | `npm ci --prefix packages/cli` |
| Chrome extension (`chrome-extension`) | npm | `chrome-extension/package-lock.json` | `npm ci --prefix chrome-extension` |
| Documentation site (`docs-site`) | npm | `docs-site/package-lock.json` | `npm ci --prefix docs-site` |

Commit changes to the authoritative lockfile when changing that package's dependencies. Root `package-lock.json` and `pnpm-lock.yaml`, and `chrome-extension/pnpm-lock.yaml`, are not used by the documented installation or CI workflows.

## Checks

For VS Code extension changes, run `yarn test` from the repository root. It compiles, lints, runs unit and contract tests, then launches the VS Code integration suite. On Linux, run the integration suite under a virtual display with `xvfb-run -a yarn run test:extension`.

For nested package changes, run its locked install and build:

```sh
npm ci --prefix packages/cli
npm run build --prefix packages/cli

npm ci --prefix chrome-extension
npm run build --prefix chrome-extension

npm ci --prefix docs-site
npm run build --prefix docs-site
```

See [TESTING.md](TESTING.md) for suite ownership and the rationale for tests omitted from the unit suite.

## Pull requests and releases

Pull requests should pass the CI jobs for the affected package. Update user-facing documentation when commands, settings, or supported workflows change. For releases, keep `package.json`, `CHANGELOG.md`, and `ROADMAP.md` aligned and verify the package builds.
