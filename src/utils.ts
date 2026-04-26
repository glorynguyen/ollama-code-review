import * as vscode from 'vscode';

import * as crypto from 'crypto';

export function generateToolCallId(): string {
	return `call_${crypto.randomBytes(4).toString('hex')}`;
}

export function getOllamaModel(config: vscode.WorkspaceConfiguration): string {
    let model = config.get<string>('model', 'kimi-k2.5:cloud');
    if (model === 'custom') {
        model = config.get<string>('customModel') || 'kimi-k2.5:cloud';
    }
    return model;
}

/**
 * Escapes HTML special characters to prevent XSS in webview content.
 * @param text - The text to escape
 * @returns The escaped text safe for HTML rendering
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Resolves a prompt template by replacing ${variable} placeholders with provided values.
 * Unknown variables are left as-is in the template.
 */
export function resolvePrompt(template: string, variables: Record<string, string>): string {
    return template.replace(/\$\{(\w+)\}/g, (match, name) => {
        return name in variables ? variables[name] : match;
    });
}

export function extractToolCalls(text: string): Array<{ name: string; arguments: string }> {
	const toolCalls: Array<{ name: string; arguments: string }> = [];
	const seen = new Set<string>();

	function addToolCall(name: string, args: string) {
		const key = `${name}:${args}`;
		if (!seen.has(key)) {
			toolCalls.push({ name, arguments: args });
			seen.add(key);
		}
	}

	// 1. Try balanced brace extraction (handles well-formed nested JSON)
	const blocks = [];
	let braceCount = 0;
	let start = -1;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (escaped) { escaped = false; continue; }
		if (char === '\\') { escaped = true; continue; }
		if (char === '"') { inString = !inString; continue; }
		if (!inString) {
			if (char === '{') {
				if (braceCount === 0) {start = i;}
				braceCount++;
			} else if (char === '}') {
				braceCount--;
				if (braceCount === 0 && start !== -1) {
					blocks.push(text.substring(start, i + 1));
					start = -1;
				}
			}
		}
	}

	for (const block of blocks) {
		try {
			let cleanBlock = block.trim();
			// Strip markdown code fences if present
			if (cleanBlock.startsWith('```')) {
				cleanBlock = cleanBlock.replace(/^```[a-z]*\n?|```$/g, '').trim();
			}

			// Attempt full parse first
			try {
				const parsed = JSON.parse(cleanBlock);
				if (parsed.tool && parsed.args) {
					addToolCall(
						String(parsed.tool),
						typeof parsed.args === 'string' ? parsed.args : JSON.stringify(parsed.args)
					);
					continue;
				}
			} catch { /* fallback to surgical */ }

			// Surgical extraction within the block
			const toolMatch = cleanBlock.match(/"tool"\s*:\s*"([^"]+)"/);
			const argsMatch = cleanBlock.match(/"args"\s*:\s*/);
			if (toolMatch && argsMatch) {
				const name = toolMatch[1];
				const argsText = extractArgsObject(cleanBlock, argsMatch.index! + argsMatch[0].length);
				if (argsText) {addToolCall(name, argsText);}
			}
		} catch { /* skip */ }
	}

	// 2. Global Regex Fallback (catches malformed/unbalanced blocks)
	const globalRegex = /"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*/g;
	let match;
	while ((match = globalRegex.exec(text)) !== null) {
		const name = match[1];
		const argsText = extractArgsObject(text, match.index + match[0].length);
		if (argsText) {addToolCall(name, argsText);}
	}

	return toolCalls;
}

/** 
 * Safely extracts a balanced JSON object starting at the given index.
 * Handles strings, escapes, and nesting.
 */
function extractArgsObject(text: string, startIndex: number): string | null {
	let braceCount = 0;
	let start = -1;
	let inString = false;
	let escaped = false;

	for (let i = startIndex; i < text.length; i++) {
		const char = text[i];
		if (escaped) { escaped = false; continue; }
		if (char === '\\') { escaped = true; continue; }
		if (char === '"') { inString = !inString; continue; }
		if (!inString) {
			if (char === '{') {
				if (braceCount === 0) {start = i;}
				braceCount++;
			} else if (char === '}') {
				if (braceCount > 0) {
					braceCount--;
					if (braceCount === 0 && start !== -1) {
						return text.substring(start, i + 1);
					}
				}
			}
		}
	}
	return null;
}
