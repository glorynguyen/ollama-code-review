/**
 * Barrel exports for built-in monorepo strategies.
 *
 * To add a new strategy (e.g. Nx, Lerna, Rush) create a file in this directory
 * that exports a `MonorepoStrategy` and add it to `builtInStrategies` below.
 */

export { npmWorkspacesStrategy } from './npmWorkspaces';
export { pnpmWorkspacesStrategy } from './pnpmWorkspaces';
export { tsPathsStrategy } from './tsPaths';

import type { MonorepoStrategy } from '../types';
import { npmWorkspacesStrategy } from './npmWorkspaces';
import { pnpmWorkspacesStrategy } from './pnpmWorkspaces';
import { tsPathsStrategy } from './tsPaths';

/**
 * Default strategy list, ordered by detection priority.
 * pnpm is checked first because a project can have both `pnpm-workspace.yaml`
 * and a `workspaces` field in package.json — pnpm's file is the source of truth.
 */
export const builtInStrategies: MonorepoStrategy[] = [
	pnpmWorkspacesStrategy,
	npmWorkspacesStrategy,
	tsPathsStrategy,
];
