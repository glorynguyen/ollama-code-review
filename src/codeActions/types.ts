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

/**
 * Parse AI response that contains a code block followed by explanation
 */
export function parseCodeResponse(response: string): CodeActionResult | null {
	const codeBlockRegex = /```(?:[a-zA-Z0-9]+)?\s*\n([\s\S]+?)\n```/;
	const match = response.match(codeBlockRegex);

	if (match && match[1]) {
		const code = match[1];
		const explanation = response.substring(match[0].length).trim();
		return { code, explanation };
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
	const codeBlockRegex = /```(?:[a-zA-Z0-9]+)?\s*\n([\s\S]+?)\n```/;
	const match = response.match(codeBlockRegex);

	if (match && match[1]) {
		const testCode = match[1];
		const explanation = response.substring(match[0].length).trim();

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
