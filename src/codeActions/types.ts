import * as vscode from 'vscode';

/**
 * Common types for code actions
 */

export interface CodeActionResult {
	code: string;
	explanation: string;
}

export interface TestGenerationResult {
	testCode: string;
	testFileName: string;
	explanation: string;
}

export interface DocumentationResult {
	documentation: string;
	explanation: string;
}

function extractFirstCodeBlock(response: string): { code: string; end: number } | null {
	const codeBlockRegex = /```[^\S\r\n]*(?:[a-zA-Z0-9_+#.-]+)?[^\S\r\n]*(?:\r?\n)([\s\S]*?)(?:\r?\n)?```/;
	const match = codeBlockRegex.exec(response);

	if (match && match[1] !== undefined) {
		return {
			code: match[1],
			end: (match.index ?? 0) + match[0].length,
		};
	}

	return null;
}

/**
 * Parse AI response that contains a code block followed by explanation
 */
export function parseCodeResponse(response: string): CodeActionResult | null {
	const codeBlock = extractFirstCodeBlock(response);

	if (codeBlock) {
		const explanation = response.substring(codeBlock.end).trim();
		return { code: codeBlock.code, explanation };
	}

	// Fallback if no code block is found
	if (!response.includes('```')) {
		return { code: response, explanation: 'Code provided as raw text.' };
	}

	return null;
}

/**
 * Parse AI response for test generation
 */
export function parseTestResponse(response: string, originalFileName: string): TestGenerationResult | null {
	const codeBlock = extractFirstCodeBlock(response);

	if (codeBlock) {
		const testCode = codeBlock.code;
		const explanation = response.substring(codeBlock.end).trim();

		// Generate test file name based on original file
		const ext = originalFileName.match(/\.[^.]+$/)?.[0] || '.ts';
		const baseName = originalFileName.replace(/\.[^.]+$/, '');
		const testFileName = `${baseName}.test${ext}`;

		return { testCode, testFileName, explanation };
	}

	return null;
}

/**
 * Extract function/class name from code for context
 */
export function extractSymbolName(code: string): string | null {
	// Try to match function declarations
	const functionMatch = code.match(/(?:async\s+)?function\s+(\w+)/);
	if (functionMatch) {
		return functionMatch[1];
	}

	// Try to match arrow function assignments
	const arrowMatch = code.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
	if (arrowMatch) {
		return arrowMatch[1];
	}

	// Try to match method definitions
	const methodMatch = code.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/);
	if (methodMatch) {
		return methodMatch[1];
	}

	// Try to match class declarations
	const classMatch = code.match(/class\s+(\w+)/);
	if (classMatch) {
		return classMatch[1];
	}

	return null;
}

/**
 * Create a virtual document URI for diff view
 */
export function createVirtualUri(scheme: string, fileName: string, suffix: string): vscode.Uri {
	const timestamp = Date.now();
	return vscode.Uri.parse(`${scheme}:${suffix}/${fileName}?ts=${timestamp}`);
}
