import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	doRangesOverlap,
	filterOverlappingBatchFixes,
	sortBatchFixesForApply,
	type BatchFixCandidate,
} from '../codeActions';
import type { ReviewFinding } from '../github/commentMapper';

function finding(message: string, line: number): ReviewFinding {
	return {
		severity: 'high',
		message,
		file: 'src/example.ts',
		line,
	};
}

function candidate(filePath: string, startLine: number, endLine: number, message: string): BatchFixCandidate {
	return {
		finding: finding(message, startLine + 1),
		fileUri: vscode.Uri.file(filePath),
		filePath,
		range: new vscode.Range(startLine, 0, endLine, 0),
		originalCode: `original ${message}`,
		fixedCode: `fixed ${message}`,
		explanation: `explanation ${message}`,
		issue: message,
		languageId: 'typescript',
	};
}

suite('Batch Fix Test Suite', () => {
	test('contributes Fix All Findings command and Findings toolbar action', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			console.warn('Skipping test: No workspace folder open');
			return;
		}

		const packageJsonPath = path.join(workspaceFolder.uri.fsPath, 'package.json');
		const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as {
			contributes?: {
				commands?: Array<{ command: string; title?: string; icon?: string }>;
				menus?: {
					'view/title'?: Array<{ command: string; when?: string; group?: string }>;
				};
			};
		};

		const command = packageJson.contributes?.commands?.find(
			item => item.command === 'ollama-code-review.fixAllFindings',
		);
		assert.ok(command, 'Fix All Findings command should be contributed');
		assert.strictEqual(command.title, 'Fix All Findings');
		assert.strictEqual(command.icon, '$(wrench)');

		const toolbarItem = packageJson.contributes?.menus?.['view/title']?.find(
			item => item.command === 'ollama-code-review.fixAllFindings',
		);
		assert.ok(toolbarItem, 'Fix All Findings should appear in the Findings Explorer toolbar');
		assert.strictEqual(toolbarItem.when, 'view == ai-review.findings-explorer && ollama-code-review.hasFindings');
		assert.strictEqual(toolbarItem.group, 'navigation@0');
	});

	test('detects overlapping ranges', () => {
		assert.strictEqual(
			doRangesOverlap(
				new vscode.Range(1, 0, 5, 0),
				new vscode.Range(4, 0, 8, 0),
			),
			true,
		);

		assert.strictEqual(
			doRangesOverlap(
				new vscode.Range(1, 0, 5, 0),
				new vscode.Range(5, 0, 8, 0),
			),
			false,
		);
	});

	test('skips overlapping batch fixes in the same file', () => {
		const first = candidate('/repo/src/example.ts', 1, 5, 'first');
		const overlapping = candidate('/repo/src/example.ts', 4, 8, 'overlapping');
		const separate = candidate('/repo/src/example.ts', 9, 12, 'separate');
		const otherFile = candidate('/repo/src/other.ts', 4, 8, 'other-file');

		const result = filterOverlappingBatchFixes([first, overlapping, separate, otherFile]);

		assert.deepStrictEqual(result.accepted.map(item => item.issue), ['first', 'separate', 'other-file']);
		assert.strictEqual(result.skipped.length, 1);
		assert.strictEqual(result.skipped[0].finding.message, 'overlapping');
	});

	test('sorts fixes bottom-to-top within each file for apply', () => {
		const top = candidate('/repo/src/example.ts', 1, 3, 'top');
		const bottom = candidate('/repo/src/example.ts', 20, 22, 'bottom');
		const middle = candidate('/repo/src/example.ts', 10, 12, 'middle');

		const sorted = sortBatchFixesForApply([top, bottom, middle]);

		assert.deepStrictEqual(sorted.map(item => item.issue), ['bottom', 'middle', 'top']);
	});
});
