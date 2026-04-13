import * as path from 'path';
import * as vscode from 'vscode';
import { ChatSidebarProvider } from '../chat/sidebarProvider';
import { FixPreviewPanel } from '../codeActions';
import { type ReviewFinding } from '../github/commentMapper';
import { ReviewDecorationsManager } from '../reviewDecorations';
import { FindingsTreeProvider } from '../reviewFindings';
import { computeScore, ReviewHistoryPanel, ReviewScoreStore } from '../reviewScore';
import { generateFix } from './aiActions';
import { type CommandContext } from './commandContext';
import { runGitCommand } from './uiHelpers';

interface FindingsCommandsRegistration {
	provider: FindingsTreeProvider;
	disposables: vscode.Disposable[];
}

async function resolveWorkspaceFileUri(filePath: string): Promise<vscode.Uri | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (workspaceFolders) {
		for (const folder of workspaceFolders) {
			const candidateUri = vscode.Uri.joinPath(folder.uri, filePath);
			try {
				await vscode.workspace.fs.stat(candidateUri);
				return candidateUri;
			} catch {
				// File not found in this folder, try next.
			}
		}
	}

	try {
		const absoluteUri = vscode.Uri.file(filePath);
		await vscode.workspace.fs.stat(absoluteUri);
		return absoluteUri;
	} catch {
		return undefined;
	}
}

function updateFindingsFilterState(treeView: vscode.TreeView<unknown>, provider: FindingsTreeProvider): void {
	void vscode.commands.executeCommand('setContext', 'ollama-code-review.findingsFiltered', provider.isFiltered);
	treeView.description = provider.isFiltered
		? `Showing ${provider.filteredCount} of ${provider.count}`
		: undefined;
}

export function registerFindingsCommands(
	commandContext: CommandContext,
): FindingsCommandsRegistration {
	const provider = new FindingsTreeProvider();
	const treeView = vscode.window.createTreeView('ai-review.findings-explorer', {
		treeDataProvider: provider,
		showCollapseAll: true,
	});

	const goToFindingCommand = vscode.commands.registerCommand(
		'ollama-code-review.goToFinding',
		async (filePath: string, line?: number) => {
			if (!filePath) { return; }

			const fileUri = await resolveWorkspaceFileUri(filePath);
			if (!fileUri) {
				vscode.window.showWarningMessage(`Could not find file: ${filePath}`);
				return;
			}

			const lineNum = line ? Math.max(0, line - 1) : 0;
			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, {
				selection: new vscode.Range(lineNum, 0, lineNum, 0),
				preserveFocus: false,
			});
			editor.revealRange(
				new vscode.Range(lineNum, 0, lineNum, 0),
				vscode.TextEditorRevealType.InCenter,
			);
		},
	);

	const clearFindingsCommand = vscode.commands.registerCommand(
		'ollama-code-review.clearFindings',
		() => {
			provider.clear();
			treeView.description = undefined;
			void vscode.commands.executeCommand('setContext', 'ollama-code-review.hasFindings', false);
			void vscode.commands.executeCommand('setContext', 'ollama-code-review.findingsFiltered', false);
		},
	);

	const filterFindingsCommand = vscode.commands.registerCommand(
		'ollama-code-review.filterFindings',
		async () => {
			if (provider.count === 0) {
				vscode.window.showInformationMessage('No findings to filter. Run a review first.');
				return;
			}

			await provider.showFilterPicker();
			updateFindingsFilterState(treeView, provider);
		},
	);

	const showAllFindingsCommand = vscode.commands.registerCommand(
		'ollama-code-review.showAllFindings',
		() => {
			provider.showAll();
			updateFindingsFilterState(treeView, provider);
		},
	);

	const exportFindingsCommand = vscode.commands.registerCommand(
		'ollama-code-review.exportFindings',
		async () => {
			if (provider.count === 0) {
				vscode.window.showInformationMessage('No findings to export. Run a review first.');
				return;
			}

			const markdown = provider.exportAsMarkdown();
			const choice = await vscode.window.showQuickPick(
				[
					{ label: '$(clippy) Copy to Clipboard', action: 'clipboard' },
					{ label: '$(markdown) Save as Markdown File', action: 'save' },
				],
				{ placeHolder: 'Export findings as...' },
			);

			if (!choice) { return; }

			if (choice.action === 'clipboard') {
				await vscode.env.clipboard.writeText(markdown);
				vscode.window.showInformationMessage(`Copied ${provider.filteredCount} findings to clipboard.`);
				return;
			}

			const uri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file('review-findings.md'),
				filters: { 'Markdown': ['md'] },
			});
			if (!uri) { return; }

			await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		},
	);

	const fixFindingCommand = vscode.commands.registerCommand(
		'ollama-code-review.fixFinding',
		async (findingOrElement?: unknown) => {
			try {
				let finding: { severity: string; message: string; file?: string; line?: number; suggestion?: string } | undefined;

				if (findingOrElement && typeof findingOrElement === 'object' && 'message' in findingOrElement && 'severity' in findingOrElement) {
					finding = findingOrElement as { severity: string; message: string; file?: string; line?: number; suggestion?: string };
				} else if (findingOrElement) {
					finding = provider.getFindingFromElement(findingOrElement);
				}

				if (!finding || !finding.file || finding.file === '(no file reference)') {
					vscode.window.showWarningMessage('This finding is not associated with a file, so it cannot be auto-fixed.');
					return;
				}

				const fileUri = await resolveWorkspaceFileUri(finding.file);
				if (!fileUri) {
					vscode.window.showWarningMessage(`Could not find file: ${finding.file}`);
					return;
				}

				const doc = await vscode.workspace.openTextDocument(fileUri);
				const targetLine = finding.line ? Math.max(0, finding.line - 1) : 0;
				const contextLines = 15;
				const startLine = Math.max(0, targetLine - contextLines);
				const endLine = Math.min(doc.lineCount - 1, targetLine + contextLines);
				const codeRange = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
				const codeSnippet = doc.getText(codeRange);
				const languageId = doc.languageId;
				const issue = `[${finding.severity.toUpperCase()}] ${finding.message}${finding.suggestion ? '\n\nSuggested fix:\n' + finding.suggestion : ''}`;

				const editor = await vscode.window.showTextDocument(doc, {
					selection: new vscode.Range(targetLine, 0, targetLine, 0),
					preserveFocus: false,
				});
				editor.revealRange(
					new vscode.Range(targetLine, 0, targetLine, 0),
					vscode.TextEditorRevealType.InCenter,
				);

				await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Generating fix for finding...', cancellable: false },
					async () => {
						const result = await generateFix(codeSnippet, issue, languageId);
						FixPreviewPanel.createOrShow(
							editor,
							codeRange,
							codeSnippet,
							result.code,
							result.explanation,
							issue,
							languageId,
							finding as ReviewFinding,
						);
					},
				);
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to generate fix: ${err instanceof Error ? err.message : String(err)}`);
				commandContext.outputChannel.appendLine(`[F-033 fixFinding] Error: ${err}`);
			}
		},
	);

	const ignoreFindingCommand = vscode.commands.registerCommand(
		'ollama-code-review.ignoreFinding',
		async (finding: ReviewFinding) => {
			if (!finding) { return; }

			ReviewDecorationsManager.getInstance().removeFinding(finding);
			provider.removeFinding(finding);

			const summary = ReviewDecorationsManager.getInstance().getFindingSummary();
			const scoreResult = computeScore(summary);
			commandContext.showScoreStatusBar(scoreResult.score);

			const globalStoragePath = commandContext.getGlobalStoragePath();
			if (globalStoragePath) {
				const store = ReviewScoreStore.getInstance(globalStoragePath);
				store.updateLastScore(summary);
				if (ReviewHistoryPanel.currentPanel) {
					ReviewHistoryPanel.createOrShow(store.getAllScores());
				}
			}

			void vscode.commands.executeCommand('setContext', 'ollama-code-review.hasFindings', provider.count > 0);
			updateFindingsFilterState(treeView, provider);
			vscode.window.setStatusBarMessage(`$(check) Finding ignored. New score: ${scoreResult.score}/100`, 3000);
		},
	);

	const askFindingCommand = vscode.commands.registerCommand(
		'ollama-code-review.askFinding',
		async (findingOrElement?: unknown) => {
			try {
				const chatProvider = ChatSidebarProvider.getInstance();
				if (!chatProvider) {
					vscode.window.showErrorMessage('Chat sidebar is not available yet. Please reopen the extension.');
					return;
				}

				let finding: { severity: string; message: string; file?: string; line?: number; suggestion?: string } | undefined;
				if (findingOrElement && typeof findingOrElement === 'object' && 'message' in findingOrElement && 'severity' in findingOrElement) {
					finding = findingOrElement as { severity: string; message: string; file?: string; line?: number; suggestion?: string };
				} else if (findingOrElement) {
					finding = provider.getFindingFromElement(findingOrElement);
				}

				if (!finding) {
					vscode.window.showWarningMessage('No finding selected.');
					return;
				}

				const detailLines = [
					'Finding Details:',
					`Severity: ${finding.severity}`,
					`Message: ${finding.message}`,
					finding.file && finding.file !== '(no file reference)' ? `File: ${finding.file}` : '',
					finding.line ? `Line: ${finding.line}` : '',
					finding.suggestion ? `Suggestion: ${finding.suggestion}` : '',
				].filter(Boolean);

				let context = detailLines.join('\n');

				if (finding.file && finding.file !== '(no file reference)') {
					const fileUri = await resolveWorkspaceFileUri(finding.file);
					if (!fileUri) {
						vscode.window.showWarningMessage(`Could not find file: ${finding.file}. Starting chat without code snippet.`);
					} else {
						const doc = await vscode.workspace.openTextDocument(fileUri);
						if (doc.lineCount > 0) {
							const contextLines = 8;
							const targetLine = finding.line && finding.line >= 1 && finding.line <= doc.lineCount
								? finding.line - 1
								: 0;
							const startLine = Math.max(0, targetLine - contextLines);
							const endLine = Math.min(doc.lineCount - 1, targetLine + contextLines);
							const codeRange = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
							const codeSnippet = doc.getText(codeRange);
							if (codeSnippet.trim()) {
								const rangeLabel = `${finding.file}:${startLine + 1}-${endLine + 1}`;
								context += `\n\nCode Snippet (${rangeLabel}):\n\`\`\`${doc.languageId}\n${codeSnippet}\n\`\`\``;
							}
						}
					}
				}

				const titleBase = finding.message.replace(/\s+/g, ' ').trim();
				const titleSuffix = titleBase.length > 48 ? `${titleBase.slice(0, 45)}...` : titleBase;
				const title = titleSuffix ? `Finding (${finding.severity}): ${titleSuffix}` : 'Finding Follow-up';

				await chatProvider.handleDiscussFinding(context, title);
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to open chat for finding: ${err instanceof Error ? err.message : String(err)}`);
				commandContext.outputChannel.appendLine(`[F-038 askFinding] Error: ${err}`);
			}
		},
	);

	let lastDiffBeforeUri: vscode.Uri | undefined;
	const viewFindingDiffCommand = vscode.commands.registerCommand(
		'ollama-code-review.viewFindingDiff',
		async (findingOrElement?: unknown) => {
			try {
				let finding: { severity: string; message: string; file?: string; line?: number } | undefined;
				let filePath: string | undefined;

				if (findingOrElement && typeof findingOrElement === 'object' && 'message' in findingOrElement && 'severity' in findingOrElement) {
					finding = findingOrElement as { severity: string; message: string; file?: string; line?: number };
					filePath = finding.file;
				} else if (findingOrElement) {
					finding = provider.getFindingFromElement(findingOrElement);
					if (finding) {
						filePath = finding.file;
					} else {
						filePath = provider.getFilePathFromElement(findingOrElement);
						finding = provider.getFirstFindingForFile(findingOrElement);
					}
				}

				if (!filePath || filePath === '(no file reference)') {
					vscode.window.showWarningMessage('No file reference found for this finding.');
					return;
				}

				const afterUri = await resolveWorkspaceFileUri(filePath);
				if (!afterUri) {
					vscode.window.showWarningMessage(`Could not find file: ${filePath}`);
					return;
				}

				const workspaceFolder = vscode.workspace.getWorkspaceFolder(afterUri);
				const repoRoot = workspaceFolder?.uri.fsPath;
				if (!repoRoot) {
					vscode.window.showWarningMessage('Could not determine workspace root.');
					return;
				}
				const relativePath = path.relative(repoRoot, afterUri.fsPath).replace(/\\/g, '/');

				let beforeContent = '';
				try {
					beforeContent = await runGitCommand(repoRoot, ['show', `HEAD:${relativePath}`]);
				} catch {
					beforeContent = '';
				}

				if (lastDiffBeforeUri) {
					commandContext.suggestionProvider.deleteContent(lastDiffBeforeUri);
				}

				const ts = Date.now();
				const beforeUri = vscode.Uri.parse(`ollama-suggestion:diff-before/${path.basename(filePath)}?ts=${ts}`);
				commandContext.suggestionProvider.setContent(beforeUri, beforeContent);
				lastDiffBeforeUri = beforeUri;

				const severity = finding?.severity ? ` [${finding.severity.toUpperCase()}]` : '';
				await vscode.commands.executeCommand(
					'vscode.diff',
					beforeUri,
					afterUri,
					`${filePath}${severity} — Review Diff`,
					{
						preview: true,
					},
				);

				if (finding?.line) {
					const line = finding.line;
					setTimeout(() => {
						const editor = vscode.window.activeTextEditor;
						if (editor) {
							const lineNum = Math.max(0, line - 1);
							const range = new vscode.Range(lineNum, 0, lineNum, 0);
							editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
						}
					}, 300);
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to open diff viewer: ${err instanceof Error ? err.message : String(err)}`);
				commandContext.outputChannel.appendLine(`[F-044 viewFindingDiff] Error: ${err}`);
			}
		},
	);

	return {
		provider,
		disposables: [
			treeView,
			goToFindingCommand,
			clearFindingsCommand,
			filterFindingsCommand,
			showAllFindingsCommand,
			exportFindingsCommand,
			fixFindingCommand,
			ignoreFindingCommand,
			askFindingCommand,
			viewFindingDiffCommand,
		],
	};
}
