import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveAndValidatePath } from '../utils/pathValidation';

suite('File Operations Test Suite', () => {
	vscode.window.showInformationMessage('Start File Operations tests.');

	test('resolveAndValidatePath should validate a path within workspace', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			console.warn('Skipping test: No workspace folder open');
			return;
		}

		const repoPaths = workspaceFolders.map(f => f.uri.fsPath);
		const fileName = 'test-file-' + Date.now() + '.txt';

		const validation = await resolveAndValidatePath(fileName, repoPaths);
		assert.strictEqual(validation.valid, true, 'Path should be valid');
		if (validation.valid) {
			assert.ok(validation.resolvedPath.includes(fileName), 'Resolved path should contain filename');
		}
	});

	test('resolveAndValidatePath should reject a path outside workspace', async () => {
		const repoPaths = ['/tmp/fake-repo']; // Use a path that is likely outside the current workspace
		const fileName = '../../etc/passwd';

		const validation = await resolveAndValidatePath(fileName, repoPaths);
		assert.strictEqual(validation.valid, false, 'Path outside workspace should be invalid');
		if (!validation.valid) {
			assert.ok(validation.error.includes('Access denied'), 'Error should mention access denied');
		}
	});

	test('File creation logic verification', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			console.warn('Skipping test: No workspace folder open');
			return; // Skip if no workspace
		}

		const repoPaths = workspaceFolders.map(f => f.uri.fsPath);
		const fileName = 'integration-test-' + Date.now() + '.txt';
		const content = 'Integration test content';

		const validation = await resolveAndValidatePath(fileName, repoPaths);
		if (!validation.valid) {
			assert.fail(validation.error);
		}

		const { resolvedPath } = validation;

		try {
			await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
			await fs.writeFile(resolvedPath, content, 'utf-8');
			
			const exists = await fs.access(resolvedPath).then(() => true).catch(() => false);
			assert.ok(exists, 'File should exist after creation');

			const readContent = await fs.readFile(resolvedPath, 'utf-8');
			assert.strictEqual(readContent, content, 'File content should match');

			// Cleanup
			await fs.unlink(resolvedPath);
		} catch (err) {
			assert.fail(`File operations failed: ${err}`);
		}
	});
});
