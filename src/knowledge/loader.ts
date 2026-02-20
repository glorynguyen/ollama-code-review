/**
 * F-012: Team Knowledge Base — YAML Loader
 *
 * Reads and parses `.ollama-review-knowledge.yaml` from the workspace root.
 * Results are cached for the lifetime of the workspace session and can be
 * invalidated by calling {@link clearKnowledgeCache}.
 *
 * Follows the same caching and validation pattern as `config/promptLoader.ts`.
 */
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import type { KnowledgeYamlConfig, KnowledgeBaseConfig, KnowledgeDecision, KnowledgePattern } from './types';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** `undefined` = not yet loaded; `null` = file not found / invalid */
let _cachedKnowledge: KnowledgeYamlConfig | null | undefined = undefined;
let _cachedWorkspaceRoot: string | undefined = undefined;

// ---------------------------------------------------------------------------
// Core loader
// ---------------------------------------------------------------------------

/**
 * Reads and parses `.ollama-review-knowledge.yaml` from the first workspace
 * folder root. Results are cached until {@link clearKnowledgeCache} is called.
 *
 * Returns `null` if the file does not exist, cannot be read, or is malformed.
 */
export async function loadKnowledgeBase(
	outputChannel?: vscode.OutputChannel
): Promise<KnowledgeYamlConfig | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return null;
	}

	const workspaceRoot = workspaceFolders[0].uri;
	const workspaceRootStr = workspaceRoot.toString();

	// Invalidate cache when workspace changes
	if (_cachedWorkspaceRoot !== workspaceRootStr) {
		_cachedKnowledge = undefined;
		_cachedWorkspaceRoot = workspaceRootStr;
	}

	// Return cached result if available
	if (_cachedKnowledge !== undefined) {
		return _cachedKnowledge;
	}

	const configUri = vscode.Uri.joinPath(workspaceRoot, '.ollama-review-knowledge.yaml');

	try {
		const fileBytes = await vscode.workspace.fs.readFile(configUri);
		const yamlContent = Buffer.from(fileBytes).toString('utf-8');

		const parsed = yaml.load(yamlContent);

		if (parsed === null || parsed === undefined) {
			_cachedKnowledge = null;
			return null;
		}

		if (typeof parsed !== 'object' || Array.isArray(parsed)) {
			const msg = '.ollama-review-knowledge.yaml must be a YAML mapping (key-value object). Knowledge base ignored.';
			outputChannel?.appendLine(`[Ollama Code Review] Warning: ${msg}`);
			vscode.window.showWarningMessage(`Ollama Code Review: ${msg}`);
			_cachedKnowledge = null;
			return null;
		}

		const config = parsed as KnowledgeYamlConfig;
		_validateKnowledge(config, outputChannel);

		_cachedKnowledge = config;

		const entryCount = (config.decisions?.length ?? 0)
			+ (config.patterns?.length ?? 0)
			+ (config.rules?.length ?? 0);
		outputChannel?.appendLine(
			`[Ollama Code Review] Loaded knowledge base from .ollama-review-knowledge.yaml (${entryCount} entries)`
		);

		return config;
	} catch (err: any) {
		if (err?.code === 'FileNotFound' || err?.name === 'EntryNotFound') {
			_cachedKnowledge = null;
			return null;
		}

		const msg = `.ollama-review-knowledge.yaml could not be loaded: ${err?.message ?? String(err)}`;
		outputChannel?.appendLine(`[Ollama Code Review] Warning: ${msg}`);
		vscode.window.showWarningMessage(`Ollama Code Review: ${msg}`);
		_cachedKnowledge = null;
		return null;
	}
}

/**
 * Clears the in-memory knowledge cache so the next call to
 * {@link loadKnowledgeBase} re-reads the file from disk.
 */
export function clearKnowledgeCache(): void {
	_cachedKnowledge = undefined;
}

// ---------------------------------------------------------------------------
// Configuration helper
// ---------------------------------------------------------------------------

/** Read knowledge base settings from VS Code configuration. */
export function getKnowledgeBaseConfig(): KnowledgeBaseConfig {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const kb = config.get<Partial<KnowledgeBaseConfig>>('knowledgeBase', {});
	return {
		enabled: kb.enabled ?? true,
		maxEntries: kb.maxEntries ?? 10,
	};
}

// ---------------------------------------------------------------------------
// Validation (soft — logs warnings, does not throw)
// ---------------------------------------------------------------------------

function _validateKnowledge(
	config: KnowledgeYamlConfig,
	outputChannel?: vscode.OutputChannel
): void {
	const warn = (msg: string) => {
		outputChannel?.appendLine(
			`[Ollama Code Review] .ollama-review-knowledge.yaml warning: ${msg}`
		);
	};

	if (config.decisions !== undefined) {
		if (!Array.isArray(config.decisions)) {
			warn('"decisions" must be a list.');
		} else {
			for (const d of config.decisions) {
				if (!d.id || !d.title || !d.decision) {
					warn(`Decision entry missing required fields (id, title, decision): ${JSON.stringify(d)}`);
				}
			}
		}
	}

	if (config.patterns !== undefined) {
		if (!Array.isArray(config.patterns)) {
			warn('"patterns" must be a list.');
		} else {
			for (const p of config.patterns) {
				if (!p.id || !p.name || !p.description) {
					warn(`Pattern entry missing required fields (id, name, description): ${JSON.stringify(p)}`);
				}
			}
		}
	}

	if (config.rules !== undefined) {
		if (!Array.isArray(config.rules)) {
			warn('"rules" must be a list of strings.');
		} else {
			for (const r of config.rules) {
				if (typeof r !== 'string') {
					warn(`Rule entry must be a string, got: ${typeof r}`);
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/**
 * Formats the full knowledge base into a prompt-ready string section.
 * Returns an empty string if the knowledge base is empty.
 */
export function formatKnowledgeForPrompt(
	knowledge: KnowledgeYamlConfig,
	maxEntries: number = 10
): string {
	const sections: string[] = [];
	let count = 0;

	// Decisions
	if (knowledge.decisions && knowledge.decisions.length > 0) {
		const items: string[] = [];
		for (const d of knowledge.decisions) {
			if (count >= maxEntries) { break; }
			let entry = `- **[${d.id}] ${d.title}**: ${d.decision}`;
			if (d.context) {
				entry += ` (Context: ${d.context})`;
			}
			items.push(entry);
			count++;
		}
		if (items.length > 0) {
			sections.push(`**Architecture Decisions:**\n${items.join('\n')}`);
		}
	}

	// Patterns
	if (knowledge.patterns && knowledge.patterns.length > 0) {
		const items: string[] = [];
		for (const p of knowledge.patterns) {
			if (count >= maxEntries) { break; }
			let entry = `- **[${p.id}] ${p.name}**: ${p.description}`;
			if (p.example) {
				entry += `\n  \`\`\`\n  ${p.example.trim().split('\n').join('\n  ')}\n  \`\`\``;
			}
			items.push(entry);
			count++;
		}
		if (items.length > 0) {
			sections.push(`**Code Patterns:**\n${items.join('\n')}`);
		}
	}

	// Rules
	if (knowledge.rules && knowledge.rules.length > 0) {
		const items: string[] = [];
		for (const r of knowledge.rules) {
			if (count >= maxEntries) { break; }
			if (typeof r === 'string' && r.trim()) {
				items.push(`- ${r}`);
				count++;
			}
		}
		if (items.length > 0) {
			sections.push(`**Team Rules:**\n${items.join('\n')}`);
		}
	}

	if (sections.length === 0) {
		return '';
	}

	return `\n\nTeam Knowledge Base (${count} entries):\nThe following team decisions, patterns, and rules should be considered during this review. Flag any code that violates these conventions and cite the relevant entry ID.\n\n${sections.join('\n\n')}\n`;
}
