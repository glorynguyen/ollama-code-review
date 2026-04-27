import * as vscode from 'vscode';
import * as path from 'path';
import { extractSymbolName } from './types';
import { escapeHtml } from '../utils';

/**
 * Code Action Provider for "Generate Tests" functionality
 * Creates unit tests for the selected function/code
 */
export class GenerateTestsActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.RefactorExtract
	];

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range
	): vscode.CodeAction[] | undefined {
		if (range.isEmpty) {
			return undefined;
		}

		const selectedText = document.getText(range);

		// Check if selection looks like a function
		const hasFunction = /(?:function|const|let|var|class|async)\s+\w+|=>\s*{|\w+\s*\([^)]*\)\s*{/.test(selectedText);

		if (!hasFunction) {
			return undefined;
		}

		const testAction = new vscode.CodeAction(
			'Ollama: Generate Tests',
			vscode.CodeActionKind.RefactorExtract
		);

		testAction.command = {
			command: 'ollama-code-review.generateTests',
			title: 'Generate unit tests for this code',
			tooltip: 'Create unit tests for the selected function or code block'
		};

		return [testAction];
	}
}

/**
 * Panel for displaying and applying generated tests
 */
export class GenerateTestsPanel {
	public static currentPanel: GenerateTestsPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];
	private _testCode: string;
	private _testFileName: string;
	private _sourceFilePath: string;

	private constructor(
		panel: vscode.WebviewPanel,
		testCode: string,
		testFileName: string,
		explanation: string,
		sourceFilePath: string,
		languageId: string
	) {
		this._panel = panel;
		this._testCode = testCode;
		this._testFileName = testFileName;
		this._sourceFilePath = sourceFilePath;

		this._panel.webview.html = this._getHtmlForWebview(testCode, testFileName, explanation, languageId);

		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'createTestFile':
						await this._createTestFile();
						break;
					case 'copyToClipboard':
						await this._copyToClipboard();
						break;
				}
			},
			null,
			this._disposables
		);
	}

	public static createOrShow(
		testCode: string,
		testFileName: string,
		explanation: string,
		sourceFilePath: string,
		languageId: string
	) {
		const column = vscode.ViewColumn.Beside;

		if (GenerateTestsPanel.currentPanel) {
			GenerateTestsPanel.currentPanel._panel.reveal(column);
			GenerateTestsPanel.currentPanel._testCode = testCode;
			GenerateTestsPanel.currentPanel._testFileName = testFileName;
			GenerateTestsPanel.currentPanel._sourceFilePath = sourceFilePath;
			GenerateTestsPanel.currentPanel._panel.webview.html =
				GenerateTestsPanel.currentPanel._getHtmlForWebview(testCode, testFileName, explanation, languageId);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'ollamaTests',
			'Generated Tests',
			column,
			{ enableScripts: true }
		);

		GenerateTestsPanel.currentPanel = new GenerateTestsPanel(
			panel,
			testCode,
			testFileName,
			explanation,
			sourceFilePath,
			languageId
		);
	}

	private async _createTestFile() {
		try {
			const sourceDir = path.dirname(this._sourceFilePath);
			const testFilePath = path.join(sourceDir, this._testFileName);
			const testFileUri = vscode.Uri.file(testFilePath);

			// Check if file already exists
			try {
				await vscode.workspace.fs.stat(testFileUri);
				const overwrite = await vscode.window.showWarningMessage(
					`Test file "${this._testFileName}" already exists. Do you want to append to it?`,
					'Append',
					'Overwrite',
					'Cancel'
				);

				if (overwrite === 'Cancel' || !overwrite) {
					return;
				}

				if (overwrite === 'Append') {
					const existingContent = await vscode.workspace.fs.readFile(testFileUri);
					const newContent = existingContent.toString() + '\n\n' + this._testCode;
					await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(newContent, 'utf8'));
				} else {
					await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(this._testCode, 'utf8'));
				}
			} catch (statError) {
				// File doesn't exist, create it
				if (statError instanceof vscode.FileSystemError && statError.code === 'FileNotFound') {
					await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(this._testCode, 'utf8'));
				} else {
					// Re-throw unexpected errors
					throw statError;
				}
			}

			// Open the test file
			const doc = await vscode.workspace.openTextDocument(testFileUri);
			await vscode.window.showTextDocument(doc);

			vscode.window.showInformationMessage(`Test file created: ${this._testFileName}`);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to create test file: ${error}`);
		}
	}

	private async _copyToClipboard() {
		await vscode.env.clipboard.writeText(this._testCode);
		vscode.window.showInformationMessage('Test code copied to clipboard!');
	}

	private _getHtmlForWebview(testCode: string, testFileName: string, explanation: string, languageId: string): string {
		const escapedCode = escapeHtml(testCode);
		const escapedExplanation = escapeHtml(explanation);

		return `
<!DOCTYPE html>
<html>
<head>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 20px;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		.header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 20px;
		}
		.header h2 {
			margin: 0;
			color: var(--vscode-foreground);
		}
		.file-name {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 4px 12px;
			border-radius: 4px;
			font-size: 12px;
		}
		.actions {
			display: flex;
			gap: 8px;
			margin-bottom: 20px;
		}
		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 8px 16px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 13px;
		}
		button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		button.secondary:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}
		.section {
			margin-bottom: 24px;
		}
		.section-title {
			font-size: 14px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 12px;
			padding-bottom: 8px;
			border-bottom: 1px solid var(--vscode-widget-border);
		}
		.code-block {
			background: var(--vscode-textCodeBlock-background);
			border-radius: 6px;
			padding: 16px;
			overflow-x: auto;
		}
		.code-block pre {
			margin: 0;
		}
		.explanation {
			line-height: 1.6;
		}
	</style>
</head>
<body>
	<div class="header">
		<h2>Generated Tests</h2>
		<span class="file-name">${escapeHtml(testFileName)}</span>
	</div>
	<div class="actions">
		<button onclick="createFile()">Create Test File</button>
		<button class="secondary" onclick="copyCode()">Copy to Clipboard</button>
	</div>
	<div class="section">
		<div class="section-title">Test Code</div>
		<div class="code-block">
			<pre><code class="language-${languageId}">${escapedCode}</code></pre>
		</div>
	</div>
	<div class="section">
		<div class="section-title">Explanation</div>
		<div class="explanation" id="explanation"></div>
	</div>
	<script>
		const vscode = acquireVsCodeApi();

		function createFile() {
			vscode.postMessage({ command: 'createTestFile' });
		}

		function copyCode() {
			vscode.postMessage({ command: 'copyToClipboard' });
		}

		document.getElementById('explanation').innerHTML = marked.parse(\`${escapedExplanation.replace(/`/g, '\\`')}\`);
		document.querySelectorAll('pre code').forEach(hljs.highlightElement);
	</script>
</body>
</html>`;
	}

	public dispose() {
		GenerateTestsPanel.currentPanel = undefined;
		this._panel.dispose();
		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}

/**
 * Determine appropriate test file name based on source file, language, and framework
 */
export function getTestFileName(sourceFileName: string, languageId: string, framework: string): string {
	const ext = path.extname(sourceFileName);
	const baseName = path.basename(sourceFileName, ext);

	// Check if it's already a test file
	if (baseName.endsWith('.test') || baseName.endsWith('.spec') || baseName.endsWith('_test')) {
		return sourceFileName;
	}

	// Framework-specific naming conventions
	switch (languageId) {
		case 'go':
			return `${baseName}_test.go`;
		case 'python':
			// Python convention is test_*.py for most frameworks
			return `test_${baseName}.py`;
		case 'javascript':
		case 'typescript':
		case 'javascriptreact':
		case 'typescriptreact':
			if (framework.toLowerCase() === 'mocha') {
				return `${baseName}.spec${ext}`;
			}
			return `${baseName}.test${ext}`;
		case 'rust':
			return sourceFileName; // Rust usually puts tests in the same file or a tests/ folder
		default:
			return `${baseName}.test${ext}`;
	}
}

/**
 * Determine test framework based on project configuration and deep signals
 */
export async function detectTestFramework(document: vscode.TextDocument): Promise<string> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return getDefaultFramework(document.languageId);
	}

	const rootUri = workspaceFolders[0].uri;

	try {
		const languageId = document.languageId;

		// 1. JS/TS Detection
		if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(languageId)) {
			const packageJsonUri = vscode.Uri.joinPath(rootUri, 'package.json');
			try {
				const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonUri);
				const packageJson = JSON.parse(packageJsonContent.toString());
				const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
				const scripts = packageJson.scripts || {};
				const scriptsStr = JSON.stringify(scripts);

				if (deps['vitest'] || scriptsStr.includes('vitest')) { return 'vitest'; }
				if (deps['mocha'] || scriptsStr.includes('mocha')) { return 'mocha'; }
				if (deps['ava'] || scriptsStr.includes('ava')) { return 'ava'; }
				if (deps['jest'] || scriptsStr.includes('jest')) { return 'jest'; }
			} catch (e) {
				console.debug('Could not parse package.json:', e instanceof Error ? e.message : String(e));
			}

			// Check for config files
			const configs = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js'];
			for (const cfg of configs) {
				try {
					await vscode.workspace.fs.stat(vscode.Uri.joinPath(rootUri, cfg));
					return cfg.startsWith('jest') ? 'jest' : 'vitest';
				} catch (e) { /* ignore */ }
			}
			return 'jest';
		}

		// 2. Python Detection
		if (languageId === 'python') {
			// Check pyproject.toml
			try {
				const pyprojectUri = vscode.Uri.joinPath(rootUri, 'pyproject.toml');
				const content = (await vscode.workspace.fs.readFile(pyprojectUri)).toString();
				if (content.includes('[tool.pytest.ini_options]') || content.includes('pytest')) {
					return 'pytest';
				}
			} catch (e) { /* ignore */ }

			// Check requirements.txt or setup.cfg
			const pyFiles = ['requirements.txt', 'setup.cfg', 'tox.ini'];
			for (const f of pyFiles) {
				try {
					const content = (await vscode.workspace.fs.readFile(vscode.Uri.joinPath(rootUri, f))).toString();
					if (content.includes('pytest')) { return 'pytest'; }
					if (content.includes('nose2')) { return 'nose2'; }
				} catch (e) { /* ignore */ }
			}
			return 'unittest';
		}

		// 3. Go Detection
		if (languageId === 'go') {
			try {
				const goModUri = vscode.Uri.joinPath(rootUri, 'go.mod');
				const content = (await vscode.workspace.fs.readFile(goModUri)).toString();
				if (content.includes('github.com/stretchr/testify')) {
					return 'testify';
				}
			} catch (e) { /* ignore */ }
			return 'testing'; // standard library
		}

	} catch (error) {
		console.log('Error detecting test framework:', error);
	}

	return getDefaultFramework(document.languageId);
}

function getDefaultFramework(languageId: string): string {
	switch (languageId) {
		case 'python': return 'pytest';
		case 'go': return 'testing';
		case 'rust': return 'cargo test';
		case 'java': return 'JUnit';
		default: return 'jest';
	}
}

export interface FrameworkOption extends vscode.QuickPickItem {
	id: string;
}

/**
 * Get framework options for a specific language
 */
export function getFrameworkOptions(languageId: string): FrameworkOption[] {
	const common: Record<string, { label: string; description: string }[]> = {
		'javascript': [
			{ label: 'Jest', description: 'Recommended for most JS/TS projects' },
			{ label: 'Vitest', description: 'Fast Vite-native testing framework' },
			{ label: 'Mocha', description: 'Flexible test framework for Node.js' },
			{ label: 'Ava', description: 'Futuristic test runner' }
		],
		'python': [
			{ label: 'pytest', description: 'Recommended; easy to write and scale' },
			{ label: 'unittest', description: 'Built-in Python testing library' },
			{ label: 'nose2', description: 'The successor to nose' }
		],
		'go': [
			{ label: 'testing', description: 'Go standard library testing' },
			{ label: 'testify', description: 'Popular assertion and mocking toolkit' }
		],
		'rust': [
			{ label: 'cargo test', description: 'Built-in Rust test runner' }
		]
	};

	// Map aliases
	const lang = ['typescript', 'javascriptreact', 'typescriptreact'].includes(languageId) ? 'javascript' : languageId;
	const options = common[lang] || [{ label: 'Generic', description: 'Standard unit testing patterns' }];

	return options.map(opt => ({
		...opt,
		id: opt.label.toLowerCase()
	}));
}
