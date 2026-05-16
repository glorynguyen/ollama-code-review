import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	applyFixToEditor,
	doRangesOverlap,
	filterOverlappingBatchFixes,
	resolveFixApplyRange,
	sortBatchFixesForApply,
	type BatchFixCandidate,
} from '../codeActions';
import { validateGeneratedFix } from '../commands/aiActions';
import { normalizeReviewFindingInput } from '../commands/findingsCommands';
import type { ReviewFinding } from '../github/commentMapper';
import type { ValidatedStructuredReviewFinding } from '../reviewFindings';

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

	test('normalizes structured findings for quick fix commands', () => {
		const structured: ValidatedStructuredReviewFinding = {
			id: 'finding-1',
			severity: 'high',
			title: 'Unsafe access',
			summary: 'Guard the optional value before reading it.',
			confidence: 0.9,
			anchor: { file: 'src/example.ts', line: 12 },
			evidence: [
				{
					kind: 'code',
					summary: 'The value can be undefined.',
				},
			],
			fix: {
				summary: 'Add a guard clause.',
				replacement: 'if (!value) { return; }',
			},
			anchorValidation: {
				status: 'valid',
				normalizedAnchor: { file: 'src/example.ts', line: 12 },
			},
		};

		const normalized = normalizeReviewFindingInput(structured);

		assert.ok(normalized);
		assert.strictEqual(normalized.severity, 'high');
		assert.strictEqual(normalized.file, 'src/example.ts');
		assert.strictEqual(normalized.line, 12);
		assert.strictEqual(normalized.suggestion, 'if (!value) { return; }');
		assert.ok(normalized.message.includes('Unsafe access'));
	});

	test('uses original structured anchor for quick fix when validation is not valid', () => {
		const structured: ValidatedStructuredReviewFinding = {
			id: 'finding-2',
			severity: 'medium',
			title: 'Context line issue',
			summary: 'The fix still targets this file and line.',
			confidence: 0.8,
			anchor: { file: 'src/example.ts', line: 18 },
			evidence: [
				{
					kind: 'code',
					summary: 'The issue was reported on unchanged context.',
				},
			],
			anchorValidation: {
				status: 'not-added-line',
				reason: 'Line is not an added diff line.',
			},
		};

		const normalizedWithoutFallback = normalizeReviewFindingInput(structured);
		const normalizedForQuickFix = normalizeReviewFindingInput(structured, { useOriginalAnchorFallback: true });

		assert.ok(normalizedWithoutFallback);
		assert.strictEqual(normalizedWithoutFallback.file, undefined);
		assert.ok(normalizedForQuickFix);
		assert.strictEqual(normalizedForQuickFix.file, 'src/example.ts');
		assert.strictEqual(normalizedForQuickFix.line, 18);
	});

	test('rejects generated fixes that contain multi-file instructions', () => {
		const original = [
			'removeFinding(finding: ReviewFinding): void {',
			'    const index = this.findings.findIndex(f => this.matchesFinding(f, finding));',
			'}',
		].join('\n');
		const generated = [
			"import type { ReviewFinding } from '../types';",
			'',
			'export function matchesFinding(candidate: ReviewFinding, target: ReviewFinding): boolean {',
			'    return candidate.severity === target.severity;',
			'}',
			'',
			'// In FindingsTreeProvider and ReviewDecorationsManager:',
			"import { matchesFinding } from './utils/findingMatcher';",
			'',
			'// Then update the usage in both classes:',
			'removeFinding(finding: ReviewFinding): void {',
			'    const index = this.findings.findIndex(f => matchesFinding(f, finding));',
			'}',
		].join('\n');

		const validation = validateGeneratedFix(generated, original, 'typescript');

		assert.strictEqual(validation.valid, false);
		assert.ok(validation.reason?.includes('instructions') || validation.reason?.includes('imports'));
	});

	test('accepts direct replacement generated fixes', () => {
		const original = 'const value = user.name;';
		const generated = 'const value = user?.name ?? "Unknown";';

		const validation = validateGeneratedFix(generated, original, 'typescript');

		assert.strictEqual(validation.valid, true);
	});

	test('applies generated fix by replacing issue code with suggestion', async () => {
		const tempPath = path.join('/private/tmp', `ollama-code-review-fix-${Date.now()}.ts`);
		const issueCode = '    return user.name;';
		const suggestion = '    return user?.name ?? "Unknown";';
		const source = [
			'function getName(user?: { name: string }) {',
			issueCode,
			'}',
		].join('\n');

		await fs.writeFile(tempPath, source, 'utf-8');

		try {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tempPath));
			const editor = await vscode.window.showTextDocument(doc);
			const issueRange = new vscode.Range(1, 0, 1, issueCode.length);

			const applied = await applyFixToEditor(editor, issueRange, suggestion);

			assert.strictEqual(applied, true);
			assert.strictEqual(editor.document.lineAt(1).text, suggestion);
			assert.ok(!editor.document.getText().includes(issueCode));
			assert.ok(editor.document.getText().includes(suggestion));

			await editor.document.save();
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		} finally {
			await fs.unlink(tempPath).catch(() => undefined);
		}
	});

	test('relocates generated fix when original code moved before apply', async () => {
		const tempPath = path.join('/private/tmp', `ollama-code-review-fix-moved-${Date.now()}.ts`);
		const issueCode = '    return user.name;';
		const suggestion = '    return user?.name ?? "Unknown";';
		const source = [
			'function getName(user?: { name: string }) {',
			issueCode,
			'}',
		].join('\n');

		await fs.writeFile(tempPath, source, 'utf-8');

		try {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(tempPath));
			const editor = await vscode.window.showTextDocument(doc);
			const originalRange = new vscode.Range(1, 0, 1, issueCode.length);

			await editor.edit(editBuilder => {
				editBuilder.insert(new vscode.Position(0, 0), '// generated header\n');
			});

			const resolution = resolveFixApplyRange(editor.document, originalRange, issueCode);
			assert.ok(resolution.range);
			assert.strictEqual(resolution.relocated, true);
			assert.strictEqual(resolution.range!.start.line, 2);

			const applied = await applyFixToEditor(editor, originalRange, suggestion, issueCode);

			assert.strictEqual(applied, true);
			assert.strictEqual(editor.document.lineAt(2).text, suggestion);
			assert.ok(!editor.document.getText().includes(issueCode));

			await editor.document.save();
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		} finally {
			await fs.unlink(tempPath).catch(() => undefined);
		}
	});
});
