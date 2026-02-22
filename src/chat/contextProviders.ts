import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Maximum characters injected per @-mention to respect model token budgets. */
const CONTEXT_MAX_CHARS = 8000;

/** Describes one @-mention context provider for display in the UI dropdown. */
export interface ContextMentionDef {
	trigger: string;       // e.g. '@file'
	description: string;   // e.g. 'Include a workspace file as context'
}

/** The fully resolved content for one @-mention reference. */
export interface ResolvedContext {
	mention: string;   // original @-mention text, e.g. '@file src/auth.ts'
	label: string;     // human-readable label, e.g. 'File: src/auth.ts'
	content: string;   // the resolved content to inject into the AI prompt
}

/** All supported @-mention context providers, in display order. */
export const CONTEXT_MENTION_DEFS: ContextMentionDef[] = [
	{ trigger: '@file', description: 'Include a workspace file as context' },
	{ trigger: '@diff', description: 'Include current staged git changes' },
	{ trigger: '@selection', description: 'Include the current editor selection' },
	{ trigger: '@review', description: 'Include the most recent AI review' },
	{ trigger: '@knowledge', description: 'Include team knowledge base entries' },
];

/**
 * Parse and resolve all @-mentions found in `rawMessage`.
 * Returns the message with @-mention tokens removed and an array of resolved contexts.
 *
 * Supported syntax:
 *   @file path/to/file.ts   — insert file content
 *   @diff                   — insert staged git diff
 *   @selection              — insert current editor selection
 *   @review                 — insert most recent review text
 *   @knowledge              — insert team knowledge base entries
 */
export async function resolveAtMentions(
	rawMessage: string,
	lastReviewText: string,
): Promise<{ cleanedMessage: string; contexts: ResolvedContext[]; unresolved: string[] }> {
	// Match @trigger optionally followed by a non-@ argument, e.g. "@file src/auth.ts"
	const mentionPattern = /@(file|diff|selection|review|knowledge)(?:\s+([^\s@][^\n@]*))?/g;

	const contexts: ResolvedContext[] = [];
	const unresolved: string[] = [];
	const toRemove: string[] = [];

	let m: RegExpExecArray | null;
	while ((m = mentionPattern.exec(rawMessage)) !== null) {
		const fullMatch = m[0];
		const trigger = m[1];
		const args = (m[2] ?? '').trim();
		toRemove.push(fullMatch);

		const resolved = await resolveOneMention(trigger, args, lastReviewText);
		if (resolved) {
			contexts.push(resolved);
		} else {
			unresolved.push(`@${trigger}`);
		}
	}

	let cleanedMessage = rawMessage;
	for (const token of toRemove) {
		cleanedMessage = cleanedMessage.replace(token, '');
	}
	cleanedMessage = cleanedMessage.replace(/\s{2,}/g, ' ').trim();

	return { cleanedMessage, contexts, unresolved };
}

async function resolveOneMention(
	trigger: string,
	args: string,
	lastReviewText: string,
): Promise<ResolvedContext | null> {
	switch (trigger) {
		case 'file': return resolveFile(args);
		case 'diff': return resolveDiff();
		case 'selection': return resolveSelection();
		case 'review': return resolveReview(lastReviewText);
		case 'knowledge': return resolveKnowledge();
		default: return null;
	}
}

async function resolveFile(filePath: string): Promise<ResolvedContext | null> {
	if (!filePath) {
		return null;
	}
	const workspace = vscode.workspace.workspaceFolders?.[0];
	if (!workspace) {
		return null;
	}
	try {
		const uri = vscode.Uri.joinPath(workspace.uri, filePath);
		const bytes = await vscode.workspace.fs.readFile(uri);
		const content = Buffer.from(bytes).toString('utf8');
		const ext = path.extname(filePath).slice(1) || 'text';
		const truncated = content.length > CONTEXT_MAX_CHARS
			? `${content.slice(0, CONTEXT_MAX_CHARS)}\n\n[... file truncated to fit context ...]`
			: content;
		return {
			mention: `@file ${filePath}`,
			label: `File: ${filePath}`,
			content: `\`\`\`${ext}\n${truncated}\n\`\`\``,
		};
	} catch {
		return null;
	}
}

async function resolveDiff(): Promise<ResolvedContext | null> {
	const workspace = vscode.workspace.workspaceFolders?.[0];
	if (!workspace) {
		return null;
	}
	try {
		const { stdout } = await execFileAsync('git', ['diff', '--cached', '--no-color'], {
			cwd: workspace.uri.fsPath,
			maxBuffer: 4 * 1024 * 1024,
		});
		const trimmed = stdout.trim();
		if (!trimmed) {
			return null;
		}
		const truncated = trimmed.length > CONTEXT_MAX_CHARS
			? `${trimmed.slice(0, CONTEXT_MAX_CHARS)}\n\n[... diff truncated ...]`
			: trimmed;
		return {
			mention: '@diff',
			label: 'Staged changes',
			content: `\`\`\`diff\n${truncated}\n\`\`\``,
		};
	} catch {
		return null;
	}
}

function resolveSelection(): ResolvedContext | null {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.selection.isEmpty) {
		return null;
	}
	const text = editor.document.getText(editor.selection);
	if (!text.trim()) {
		return null;
	}
	const fileName = path.basename(editor.document.fileName);
	const lang = editor.document.languageId;
	const truncated = text.length > CONTEXT_MAX_CHARS
		? `${text.slice(0, CONTEXT_MAX_CHARS)}\n\n[... selection truncated ...]`
		: text;
	return {
		mention: '@selection',
		label: `Selection from ${fileName}`,
		content: `\`\`\`${lang}\n${truncated}\n\`\`\``,
	};
}

function resolveReview(lastReviewText: string): ResolvedContext | null {
	if (!lastReviewText.trim()) {
		return null;
	}
	const truncated = lastReviewText.length > CONTEXT_MAX_CHARS
		? `${lastReviewText.slice(0, CONTEXT_MAX_CHARS)}\n\n[... review truncated ...]`
		: lastReviewText;
	return {
		mention: '@review',
		label: 'Most recent review',
		content: truncated,
	};
}

async function resolveKnowledge(): Promise<ResolvedContext | null> {
	try {
		const { loadKnowledgeBase, formatKnowledgeForPrompt } = await import('../knowledge/loader.js');
		const knowledge = await loadKnowledgeBase();
		if (!knowledge) {
			return null;
		}
		const content = formatKnowledgeForPrompt(knowledge, 10);
		if (!content.trim()) {
			return null;
		}
		const truncated = content.length > CONTEXT_MAX_CHARS
			? `${content.slice(0, CONTEXT_MAX_CHARS)}\n\n[... knowledge truncated ...]`
			: content;
		return {
			mention: '@knowledge',
			label: 'Team knowledge base',
			content: truncated,
		};
	} catch {
		return null;
	}
}

/**
 * Open a VS Code file picker scoped to the current workspace.
 * Returns the selected file path relative to the workspace root, or null if cancelled.
 */
export async function pickWorkspaceFile(): Promise<string | null> {
	const workspace = vscode.workspace.workspaceFolders?.[0];
	if (!workspace) {
		void vscode.window.showWarningMessage('No workspace folder is open.');
		return null;
	}
	const uris = await vscode.window.showOpenDialog({
		canSelectMany: false,
		defaultUri: workspace.uri,
		openLabel: 'Include in Chat',
		filters: {
			'Source Files': [
				'ts', 'tsx', 'js', 'jsx', 'mts', 'mjs',
				'py', 'java', 'cs', 'go', 'rb', 'php', 'rs', 'swift', 'kt',
				'vue', 'svelte', 'html', 'css', 'scss',
				'json', 'yaml', 'yml', 'md', 'txt',
			],
			'All Files': ['*'],
		},
	});
	if (!uris?.length) {
		return null;
	}
	const absolutePath = uris[0].fsPath;
	const workspacePath = workspace.uri.fsPath;
	if (absolutePath.startsWith(workspacePath)) {
		// Return relative path with forward slashes
		return absolutePath.slice(workspacePath.length + 1).replace(/\\/g, '/');
	}
	return absolutePath;
}
