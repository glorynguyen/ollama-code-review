import * as path from 'path';
import * as vscode from 'vscode';
import { ChatSidebarProvider } from '../chat/sidebarProvider';
import {
	BatchFixPreviewPanel,
	FixPreviewPanel,
	filterOverlappingBatchFixes,
	type BatchFixCandidate,
	type SkippedBatchFix,
} from '../codeActions';
import { type ReviewFinding, type Severity } from '../github/commentMapper';
import { ReviewDecorationsManager } from '../reviewDecorations';
import {
	FindingsTreeProvider,
	toLegacyReviewFinding,
	type ValidatedStructuredReviewFinding,
} from '../reviewFindings';
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

function isSeverity(value: unknown): value is Severity {
	return value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info';
}

function isStructuredFinding(value: unknown): value is ValidatedStructuredReviewFinding {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const record = value as Record<string, unknown>;
	return typeof record.id === 'string' &&
		isSeverity(record.severity) &&
		typeof record.title === 'string' &&
		typeof record.summary === 'string' &&
		Array.isArray(record.evidence);
}

export function normalizeReviewFindingInput(
	value: unknown,
	options: { useOriginalAnchorFallback?: boolean } = {},
): ReviewFinding | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	if (isSeverity(record.severity) && typeof record.message === 'string') {
		return value as ReviewFinding;
	}

	if (!isStructuredFinding(value)) {
		return undefined;
	}

	const hasValidatedAnchor = value.anchorValidation !== undefined;
	const legacy = hasValidatedAnchor
		? toLegacyReviewFinding(value)
		: {
			severity: value.severity,
			message: [`**${value.title}**`, value.summary].filter(Boolean).join('\n\n'),
			file: value.anchor?.file,
			line: value.anchor?.line,
			suggestion: value.fix?.replacement ?? value.fix?.patch,
		};
	const canUseOriginalAnchor = !hasValidatedAnchor || options.useOriginalAnchorFallback;

	return {
		...legacy,
		message: legacy.message || [`**${value.title}**`, value.summary].filter(Boolean).join('\n\n'),
		file: legacy.file ?? (canUseOriginalAnchor ? value.anchor?.file : undefined),
		line: legacy.line ?? (canUseOriginalAnchor ? value.anchor?.line : undefined),
	};
}

function countFindingsBySeverity(findings: readonly ReviewFinding[]): Record<Severity, number> {
	const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
	for (const finding of findings) {
		counts[finding.severity]++;
	}
	return counts;
}

async function buildBatchFixCandidate(finding: ReviewFinding): Promise<BatchFixCandidate | SkippedBatchFix> {
	if (!finding.file || finding.file === '(no file reference)') {
		return { finding, reason: 'Finding has no file reference.' };
	}

	const fileUri = await resolveWorkspaceFileUri(finding.file);
	if (!fileUri) {
		return { finding, reason: `Could not find file: ${finding.file}` };
	}

	const doc = await vscode.workspace.openTextDocument(fileUri);
	if (doc.lineCount === 0) {
		return { finding, reason: `File is empty: ${finding.file}` };
	}

	const targetLine = finding.line && finding.line >= 1 && finding.line <= doc.lineCount
		? finding.line - 1
		: 0;
	const contextLines = 15;
	const startLine = Math.max(0, targetLine - contextLines);
	const endLine = Math.min(doc.lineCount - 1, targetLine + contextLines);
	const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
	const originalCode = doc.getText(range);
	const issue = `[${finding.severity.toUpperCase()}] ${finding.message}${finding.suggestion ? '\n\nSuggested fix:\n' + finding.suggestion : ''}`;
	const result = await generateFix(originalCode, issue, doc.languageId);

	return {
		finding,
		fileUri,
		filePath: finding.file,
		range,
		originalCode,
		fixedCode: result.code,
		explanation: result.explanation,
		issue,
		languageId: doc.languageId,
	};
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
				let finding: ReviewFinding | undefined;

				const normalizedFinding = normalizeReviewFindingInput(findingOrElement, { useOriginalAnchorFallback: true });
				if (normalizedFinding) {
					finding = normalizedFinding;
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

	const fixAllFindingsCommand = vscode.commands.registerCommand(
		'ollama-code-review.fixAllFindings',
		async () => {
			const findings = provider.getFindings();
			if (findings.length === 0) {
				vscode.window.showInformationMessage('No findings to fix. Run a review first.');
				return;
			}

			const fixable = findings.filter(f => f.file && f.file !== '(no file reference)');
			if (fixable.length === 0) {
				vscode.window.showInformationMessage('No file-backed findings can be auto-fixed.');
				return;
			}

			const generated: BatchFixCandidate[] = [];
			const skipped: SkippedBatchFix[] = [];

			try {
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: 'Generating batch fixes...',
						cancellable: true,
					},
					async (progress, token) => {
						for (let i = 0; i < fixable.length; i++) {
							if (token.isCancellationRequested) { return; }

							const finding = fixable[i];
							const label = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : `finding ${i + 1}`;
							progress.report({
								message: `Fixing ${i + 1}/${fixable.length}: ${label}`,
								increment: 100 / fixable.length,
							});

							try {
								const result = await buildBatchFixCandidate(finding);
								if ('fixedCode' in result) {
									generated.push(result);
								} else {
									skipped.push(result);
								}
							} catch (error) {
								skipped.push({
									finding,
									reason: error instanceof Error ? error.message : String(error),
								});
							}
						}
					},
				);

				if (generated.length === 0) {
					const skippedText = skipped.length ? ` ${skipped.length} finding${skipped.length === 1 ? '' : 's'} skipped.` : '';
					vscode.window.showWarningMessage(`No fixes were generated.${skippedText}`);
					return;
				}

				const filtered = filterOverlappingBatchFixes(generated);
				BatchFixPreviewPanel.createOrShow(filtered.accepted, [...skipped, ...filtered.skipped]);
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to generate batch fixes: ${err instanceof Error ? err.message : String(err)}`);
				commandContext.outputChannel.appendLine(`[F-045 fixAllFindings] Error: ${err}`);
			}
		},
	);

	const ignoreFindingCommand = vscode.commands.registerCommand(
		'ollama-code-review.ignoreFinding',
		async (findingInput: unknown) => {
			const finding = normalizeReviewFindingInput(findingInput, { useOriginalAnchorFallback: true });
			if (!finding) { return undefined; }

			ReviewDecorationsManager.getInstance().removeFinding(finding);
			provider.removeFinding(finding);

			const summary = countFindingsBySeverity(provider.getFindings());
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
			return { score: scoreResult.score, findingCounts: summary };
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
			fixAllFindingsCommand,
			ignoreFindingCommand,
			askFindingCommand,
			viewFindingDiffCommand,
		],
	};
}
