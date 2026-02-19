/**
 * F-007: Agentic Multi-Step Reviews — Step 1: Analyze Diff
 *
 * Parses the unified diff to extract changed files, line counts, and a
 * high-level structural summary. This is a fast, local-only step (no AI call).
 */

import type { AgentStep, AgentContext, DiffAnalysis, ChangedFileInfo } from '../types';

/** Classify a file path into a broad category. */
function classifyFile(filePath: string): string {
	const lower = filePath.toLowerCase();
	if (/\.(test|spec)\.[^.]+$/.test(lower) || lower.includes('__tests__')) {
		return 'test';
	}
	if (/\.(json|ya?ml|toml|ini|env|config\.\w+)$/.test(lower) ||
		lower.includes('eslint') || lower.includes('prettier') || lower.includes('tsconfig')) {
		return 'config';
	}
	if (/\.(md|txt|rst|adoc)$/.test(lower) || lower.startsWith('docs/') || lower === 'readme') {
		return 'docs';
	}
	if (/\.(ts|tsx|js|jsx|py|go|java|rb|cs|php|c|cpp|h|rs|swift|kt)$/.test(lower)) {
		return 'source';
	}
	return 'other';
}

/** Infer high-level change types from the diff content. */
function inferChangeTypes(diff: string, files: ChangedFileInfo[]): string[] {
	const types = new Set<string>();
	const lower = diff.toLowerCase();

	if (files.some(f => f.fileType === 'test')) { types.add('test'); }
	if (files.some(f => f.fileType === 'docs')) { types.add('docs'); }
	if (files.some(f => f.fileType === 'config')) { types.add('config'); }

	// Heuristics based on diff content
	if (lower.includes('fix') || lower.includes('bug')) { types.add('bugfix'); }
	if (lower.includes('refactor') || lower.includes('rename')) { types.add('refactor'); }
	if (/\+\s*(export\s+)?(function|class|interface|type|const|enum)\s/.test(diff)) { types.add('feature'); }

	// Default
	if (types.size === 0) { types.add('modification'); }

	return Array.from(types);
}

export const analyzeDiffStep: AgentStep<string, DiffAnalysis> = {
	name: 'analyzeDiff',
	label: 'Analyzing diff structure…',

	async execute(diff: string, ctx: AgentContext): Promise<DiffAnalysis> {
		ctx.reportProgress('Step 1/5 — Analyzing diff structure…');
		ctx.outputChannel.appendLine('[Agent] Step 1: Analyzing diff');

		const changedFiles: ChangedFileInfo[] = [];

		// Parse unified diff into per-file chunks
		const fileChunks = diff.split(/^diff --git /m).filter(Boolean);

		for (const chunk of fileChunks) {
			// Extract file path from "a/path b/path" or "+++ b/path" header
			const headerMatch = chunk.match(/\+\+\+ b\/(.+)/);
			if (!headerMatch) { continue; }

			const filePath = headerMatch[1].trim();
			let linesAdded = 0;
			let linesRemoved = 0;

			const lines = chunk.split('\n');
			for (const line of lines) {
				if (line.startsWith('+') && !line.startsWith('+++')) { linesAdded++; }
				else if (line.startsWith('-') && !line.startsWith('---')) { linesRemoved++; }
			}

			changedFiles.push({
				filePath,
				linesAdded,
				linesRemoved,
				fileType: classifyFile(filePath),
			});
		}

		const totalAdded = changedFiles.reduce((s, f) => s + f.linesAdded, 0);
		const totalRemoved = changedFiles.reduce((s, f) => s + f.linesRemoved, 0);
		const changeTypes = inferChangeTypes(diff, changedFiles);

		const summary = `${changedFiles.length} file(s) changed: +${totalAdded} -${totalRemoved} lines (${changeTypes.join(', ')})`;
		ctx.outputChannel.appendLine(`[Agent] Step 1 result: ${summary}`);

		return { changedFiles, summary, changeTypes };
	},
};
