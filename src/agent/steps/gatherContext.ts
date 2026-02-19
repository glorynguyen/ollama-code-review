/**
 * F-007: Agentic Multi-Step Reviews — Step 2: Gather Context
 *
 * Leverages the existing F-008 context-gathering system to resolve imports,
 * tests, and type definitions for the changed files. Also collects workspace
 * patterns from common config files.
 */

import * as vscode from 'vscode';
import type { AgentStep, AgentContext, DiffAnalysis, GatheredContext } from '../types';
import { gatherContext, getContextGatheringConfig } from '../../context';
import type { ContextGatheringConfig } from '../../context/types';

/** Discover workspace-level patterns from common config files. */
async function discoverWorkspacePatterns(outputChannel: vscode.OutputChannel): Promise<string[]> {
	const patterns: string[] = [];

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) { return patterns; }

	const root = workspaceFolders[0].uri;

	// Check for TypeScript config
	try {
		const tsconfig = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'tsconfig.json'));
		const text = Buffer.from(tsconfig).toString('utf-8');
		if (text.includes('"strict": true') || text.includes('"strict":true')) {
			patterns.push('TypeScript strict mode enabled');
		}
	} catch { /* no tsconfig */ }

	// Check for ESLint config
	try {
		const eslintFiles = await vscode.workspace.findFiles('**/eslint.config.*', '**/node_modules/**', 1);
		if (eslintFiles.length > 0) {
			patterns.push('ESLint configured');
		} else {
			const legacyEslint = await vscode.workspace.findFiles('**/.eslintrc*', '**/node_modules/**', 1);
			if (legacyEslint.length > 0) { patterns.push('ESLint configured (legacy config)'); }
		}
	} catch { /* ignore */ }

	// Check for test framework
	try {
		const pkgFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 1);
		if (pkgFiles.length > 0) {
			const pkgContent = await vscode.workspace.fs.readFile(pkgFiles[0]);
			const pkgText = Buffer.from(pkgContent).toString('utf-8');
			if (pkgText.includes('"jest"')) { patterns.push('Jest test framework'); }
			if (pkgText.includes('"mocha"')) { patterns.push('Mocha test framework'); }
			if (pkgText.includes('"vitest"')) { patterns.push('Vitest test framework'); }
		}
	} catch { /* ignore */ }

	return patterns;
}

export const gatherContextStep: AgentStep<DiffAnalysis, GatheredContext> = {
	name: 'gatherContext',
	label: 'Gathering workspace context…',

	async execute(diffAnalysis: DiffAnalysis, ctx: AgentContext): Promise<GatheredContext> {
		ctx.reportProgress('Step 2/5 — Gathering workspace context…');
		ctx.outputChannel.appendLine('[Agent] Step 2: Gathering context');

		// Build context config from agent settings
		const baseConfig = getContextGatheringConfig();
		const contextConfig: ContextGatheringConfig = {
			enabled: true,
			maxFiles: ctx.config.maxContextFiles,
			includeTests: ctx.config.includeTests,
			includeTypeDefinitions: ctx.config.includeTypes,
		};

		// Use the existing F-008 gatherer
		let contextBundle;
		try {
			contextBundle = await gatherContext(ctx.diff, contextConfig, ctx.outputChannel);
			ctx.outputChannel.appendLine(
				`[Agent] Step 2: Gathered ${contextBundle.files.length} context files (${contextBundle.stats.totalChars} chars)`
			);
		} catch (err) {
			ctx.outputChannel.appendLine(`[Agent] Step 2: Context gathering failed (non-fatal): ${err}`);
		}

		// Discover workspace patterns
		const workspacePatterns = await discoverWorkspacePatterns(ctx.outputChannel);
		ctx.outputChannel.appendLine(`[Agent] Step 2: Found ${workspacePatterns.length} workspace patterns`);

		return { contextBundle, workspacePatterns };
	},
};
