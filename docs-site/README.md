# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Package manager

This package uses npm and the committed `package-lock.json`. From the repository root, install with `npm ci --prefix docs-site` and run scripts with `npm run <script> --prefix docs-site`.

## Installation

```bash
npm ci
```

## Local Development

```bash
npm start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

Using SSH:

```bash
USE_SSH=true npm run deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> npm run deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.
