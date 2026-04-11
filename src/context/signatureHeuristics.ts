/**
 * Phase 2: Change Signature Heuristic (Impact Graph Agent)
 * 
 * Determines if the public API of a file has changed.
 * Includes hashing for efficient storage in globalState.
 */

import { createHash } from 'crypto';

export interface ExportSignature {
	name: string;
	type: 'function' | 'class' | 'type' | 'variable' | 'block';
	signature: string;
}

/**
 * Extracts export signatures using multiline-aware regex.
 * While not a full AST parser, it handles common multiline and block export patterns.
 */
export function extractExports(content: string): ExportSignature[] {
	const exports: ExportSignature[] = [];
	
	// 1. Handle "export { foo, bar as baz }" blocks
	const blockRegex = /export\s+\{([^}]+)\}/g;
	let match;
	while ((match = blockRegex.exec(content)) !== null) {
		const names = match[1].split(',').map(s => s.trim()).filter(Boolean);
		for (const name of names) {
			exports.push({ name, type: 'block', signature: name });
		}
	}

	// 2. Handle standard inline exports
	const patterns = [
		// export [async] function foo(...)
		{ type: 'function' as const, regex: /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g },
		// export const foo = (...) =>
		{ type: 'function' as const, regex: /export\s+const\s+(\w+)\s*=\s*(?:\([^)]*\)|[\w]+)\s*=>/g },
		// export class Foo
		{ type: 'class' as const, regex: /export\s+class\s+(\w+)/g },
		// export interface Foo | export type Foo
		{ type: 'type' as const, regex: /export\s+(?:interface|type)\s+(\w+)/g },
		// export const foo: string
		{ type: 'variable' as const, regex: /export\s+(?:const|let|var)\s+(\w+)(?:\s*:\s*([^=;{]+))?/g }
	];

	for (const { type, regex } of patterns) {
		regex.lastIndex = 0; // Reset for global regex
		while ((match = regex.exec(content)) !== null) {
			exports.push({
				name: match[1],
				type,
				signature: match[0].trim()
			});
		}
	}

	return exports;
}

/**
 * Generates a SHA-256 hash of all concatenated export signatures.
 * Storing this hash is much more memory-efficient than storing the full file content.
 */
export function getSignatureHash(content: string): string {
	const exports = extractExports(content);
	// Sort by name to ensure deterministic hashing
	const canonical = exports
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(e => `${e.type}:${e.name}:${e.signature}`)
		.join('|');
	
	return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compare two sets of signatures and return true if any "Significant" changes are detected.
 */
export function hasSignificantSignatureChange(oldContent: string, newContent: string): boolean {
	const oldExports = extractExports(oldContent);
	const newExports = extractExports(newContent);

	const oldMap = new Map(oldExports.map(e => [e.name, e]));
	const newMap = new Map(newExports.map(e => [e.name, e]));

	if (oldExports.length !== newExports.length) { return true; }

	for (const [name, newSig] of newMap.entries()) {
		const oldSig = oldMap.get(name);
		if (!oldSig || oldSig.signature !== newSig.signature || oldSig.type !== newSig.type) {
			return true;
		}
	}

	return false;
}
