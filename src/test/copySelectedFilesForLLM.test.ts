import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildSelectedFilesClipboardBundle } from '../commands';

suite('Copy Selected Files for LLM Test Suite', () => {
	test('builds clipboard content for selected files only', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			console.warn('Skipping test: No workspace folder open');
			return;
		}

		const testDir = path.join(workspaceFolder.uri.fsPath, 'test-support', `copy-selected-${Date.now()}`);
		const firstFile = path.join(testDir, 'alpha.ts');
		const secondFile = path.join(testDir, 'nested', 'beta.ts');
		const selectedDirectory = path.join(testDir, 'nested');

		await fs.mkdir(path.dirname(secondFile), { recursive: true });
		await fs.writeFile(firstFile, 'export const alpha = 1;\n', 'utf-8');
		await fs.writeFile(secondFile, 'export const beta = 2;\n', 'utf-8');

		try {
			const firstUri = vscode.Uri.file(firstFile);
			const secondUri = vscode.Uri.file(secondFile);
			const directoryUri = vscode.Uri.file(selectedDirectory);

			const bundle = await buildSelectedFilesClipboardBundle([
				firstUri,
				directoryUri,
				secondUri,
				firstUri,
			]);

			const firstRelativePath = vscode.workspace.asRelativePath(firstUri);
			const secondRelativePath = vscode.workspace.asRelativePath(secondUri);
			const expected = [
				`=== File: ${firstRelativePath} ===\nexport const alpha = 1;\n\n`,
				`=== File: ${secondRelativePath} ===\nexport const beta = 2;\n\n`,
			].join('\n');

			assert.strictEqual(bundle.fileCount, 2);
			assert.strictEqual(bundle.content, expected);
			assert.strictEqual(bundle.content.includes(`=== File: ${vscode.workspace.asRelativePath(directoryUri)} ===`), false);
			assert.strictEqual(bundle.content.match(/export const alpha = 1;/g)?.length, 1);
		} finally {
			await fs.rm(testDir, { recursive: true, force: true });
		}
	});
});
