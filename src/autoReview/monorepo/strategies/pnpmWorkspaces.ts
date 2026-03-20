/**
 * Monorepo strategy: pnpm workspaces.
 *
 * Detects workspaces defined in `pnpm-workspace.yaml` at the repo root.
 * Falls back gracefully if js-yaml is not available (shouldn't happen since
 * the extension already depends on it).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MonorepoStrategy, WorkspacePackage } from '../types';
import { expandGlobs, readPackages } from './npmWorkspaces';

export const pnpmWorkspacesStrategy: MonorepoStrategy = {
	name: 'pnpm-workspaces',

	async detect(rootPath: string): Promise<boolean> {
		try {
			await fs.promises.access(path.join(rootPath, 'pnpm-workspace.yaml'));
			return true;
		} catch {
			return false;
		}
	},

	async discoverPackages(rootPath: string): Promise<WorkspacePackage[]> {
		const raw = await fs.promises.readFile(
			path.join(rootPath, 'pnpm-workspace.yaml'),
			'utf-8',
		);

		let yaml: typeof import('js-yaml');
		try {
			yaml = await import('js-yaml');
		} catch {
			return [];
		}

		const config = yaml.load(raw) as { packages?: string[] } | undefined;
		const globs = config?.packages ?? [];

		const dirs = await expandGlobs(rootPath, globs);
		return readPackages(dirs);
	},
};
