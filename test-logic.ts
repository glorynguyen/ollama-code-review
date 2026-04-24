import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveAndValidatePath } from './src/utils/pathValidation';

async function testCreateFile() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        console.error('No workspace folder open.');
        return;
    }

    const repoPaths = workspaceFolders.map(f => f.uri.fsPath);
    const fileName = 'test-file-creation.txt';
    const code = 'Hello from test!';

    const validation = await resolveAndValidatePath(fileName, repoPaths);
    if (!validation.valid) {
        console.error(validation.error);
        return;
    }
    const { resolvedPath } = validation;

    try {
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, code, 'utf-8');
        console.log(`File created successfully at: ${resolvedPath}`);
        
        // Cleanup
        await fs.unlink(resolvedPath);
        console.log('Test file cleaned up.');
    } catch (err) {
        console.error(`Failed to create file: ${err}`);
    }
}

// In a real scenario, we'd run this through a test runner.
// For now, I'm just verifying the logic in the implementation.
