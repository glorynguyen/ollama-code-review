import * as vscode from 'vscode';
import * as path from 'path';

let rulesCache: string | null = null;

/**
 * Clear the rules directory cache.
 * Called by the file watcher when rule files change.
 */
export function clearRulesCache(): void {
	rulesCache = null;
}

/**
 * Load and concatenate all .md files from .ollama-review/rules/ in the workspace root.
 * Files are sorted by filename for deterministic ordering.
 * Returns a formatted prompt section, or empty string if no rule files are found.
 *
 * This is F-026: Rules Directory — a simpler companion to the F-012 YAML knowledge base.
 * Teams can drop plain Markdown files into .ollama-review/rules/ without learning any schema.
 */
export async function loadRulesDirectory(outputChannel?: vscode.OutputChannel): Promise<string> {
	if (rulesCache !== null) {
		return rulesCache;
	}

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		rulesCache = '';
		return '';
	}

	const ruleFiles = await vscode.workspace.findFiles('.ollama-review/rules/*.md');
	if (ruleFiles.length === 0) {
		rulesCache = '';
		return '';
	}

	// Sort by filename for deterministic ordering
	ruleFiles.sort((a, b) => path.basename(a.fsPath).localeCompare(path.basename(b.fsPath)));

	const ruleContents: string[] = [];
	for (const uri of ruleFiles) {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const content = Buffer.from(bytes).toString('utf8').trim();
			if (content) {
				const fileName = path.basename(uri.fsPath, '.md');
				ruleContents.push(`### ${fileName}\n${content}`);
			}
		} catch (err) {
			outputChannel?.appendLine(`[Rules] Error reading ${uri.fsPath}: ${err}`);
		}
	}

	if (ruleContents.length === 0) {
		rulesCache = '';
		return '';
	}

	rulesCache = `\n\n## Team Rules\n\n${ruleContents.join('\n\n---\n\n')}\n`;
	outputChannel?.appendLine(`[Rules] Loaded ${ruleFiles.length} rule file(s) from .ollama-review/rules/`);
	return rulesCache;
}
