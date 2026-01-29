import * as vscode from 'vscode';
import axios from 'axios';
import { exec } from 'child_process';
import * as path from 'path';
import { OllamaReviewPanel } from './reviewProvider';
import { SkillsService } from './skillsService';
import { SkillsBrowserPanel } from './skillsBrowserPanel';
import { getOllamaModel } from './utils';
import { filterDiff, getFilterSummary } from './diffFilter';

const CLAUDE_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const GLM_API_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';

/**
 * Check if the model is a Claude model
 */
function isClaudeModel(model: string): boolean {
	return model.startsWith('claude-');
}

/**
 * Check if the model is a GLM model (Z.AI/BigModel API)
 */
function isGlmModel(model: string): boolean {
	return model.startsWith('glm-');
}

/**
 * Get the actual GLM model name from the configured model
 * Strips the :cloud suffix if present
 */
function getGlmModelName(model: string): string {
	return model.replace(':cloud', '');
}

/**
 * Call Claude API for generating responses
 */
async function callClaudeAPI(prompt: string, config: vscode.WorkspaceConfiguration): Promise<string> {
	const model = getOllamaModel(config);
	const apiKey = config.get<string>('claudeApiKey', '');
	const temperature = config.get<number>('temperature', 0);

	if (!apiKey) {
		throw new Error('Claude API key is not configured. Please set it in Settings > Ollama Code Review > Claude Api Key');
	}

	const response = await axios.post(
		CLAUDE_API_ENDPOINT,
		{
			model: model,
			max_tokens: 8192,
			messages: [
				{
					role: 'user',
					content: prompt
				}
			],
			temperature: temperature
		},
		{
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01'
			}
		}
	);

	// Extract text from Claude's response format
	const content = response.data.content;
	if (Array.isArray(content) && content.length > 0) {
		return content.map((block: { type: string; text: string }) =>
			block.type === 'text' ? block.text : ''
		).join('').trim();
	}

	return '';
}

/**
 * Call GLM API (Z.AI/BigModel) for generating responses
 */
async function callGlmAPI(prompt: string, config: vscode.WorkspaceConfiguration): Promise<string> {
	const model = getOllamaModel(config);
	const apiKey = config.get<string>('glmApiKey', '');
	const temperature = config.get<number>('temperature', 0);

	if (!apiKey) {
		throw new Error('GLM API key is not configured. Please set it in Settings > Ollama Code Review > Glm Api Key');
	}

	const glmModel = getGlmModelName(model);

	const response = await axios.post(
		GLM_API_ENDPOINT,
		{
			model: glmModel,
			messages: [
				{
					role: 'system',
					content: 'You are an expert software engineer and code reviewer.'
				},
				{
					role: 'user',
					content: prompt
				}
			],
			temperature: temperature,
			max_tokens: 8192
		},
		{
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'Accept-Language': 'en-US,en'
			}
		}
	);

	// Extract text from GLM's OpenAI-compatible response format
	const choices = response.data.choices;
	if (Array.isArray(choices) && choices.length > 0 && choices[0].message) {
		return choices[0].message.content?.trim() || '';
	}

	return '';
}


let outputChannel: vscode.OutputChannel;

interface GitCommitDetails {
	hash: string;
	message: string;
	parents: string[];
	authorName?: string;
	commitDate?: Date;
}

interface CommitQuickPickItem extends vscode.QuickPickItem {
	hash: string;
}

/**
 * Selects a Git repository from the workspace.
 * - If only one repo, returns it.
 * - If multiple, tries to find one matching the active editor.
 * - If no match, prompts the user to choose.
 * @param gitAPI The Git API instance.
 * @returns The selected repository object, or undefined if none is selected.
 */
async function selectRepository(gitAPI: any): Promise<any | undefined> {
	const repositories = gitAPI.repositories;

	if (!repositories || repositories.length === 0) {
		vscode.window.showInformationMessage('No Git repository found in your workspace.');
		return undefined;
	}

	if (repositories.length === 1) {
		return repositories[0];
	}

	// Try to find the repo for the active file
	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		const activeFileUri = activeEditor.document.uri;
		const bestMatch = repositories.find((repo: { rootUri: { fsPath: string; }; }) => activeFileUri.fsPath.startsWith(repo.rootUri.fsPath));
		if (bestMatch) {
			return bestMatch;
		}
	}

	// If no active editor or no match, ask the user
	const quickPickItems = repositories.map((repo: any) => ({
		label: `$(repo) ${path.basename(repo.rootUri.fsPath)}`,
		description: repo.rootUri.fsPath,
		repo: repo // Store the actual repo object
	}));

	const selected = await vscode.window.showQuickPick(quickPickItems, {
		placeHolder: "Select a repository to perform the action on"
	});

	return selected ? (selected as unknown as { repo: any }).repo : undefined;
}

/**
 * Parses the suggestion from Ollama's response.
 * Expects a Markdown code block followed by an explanation.
 * @param response The raw string response from the Ollama API.
 * @returns An object with the extracted code and explanation, or null if parsing fails.
 */
function parseSuggestion(response: string): { code: string; explanation: string } | null {
	const codeBlockRegex = /```(?:[a-zA-Z0-9]+)?\s*\n([\s\S]+?)\n```/;
	const match = response.match(codeBlockRegex);

	if (match && match[1]) {
		const code = match[1];
		const explanation = response.substring(match[0].length).trim();
		return { code, explanation };
	}
	// Fallback if no code block is found, maybe the whole response is the code
	if (!response.includes('```')) {
		return { code: response, explanation: "Suggestion provided as raw code." };
	}

	return null;
}

function runGitCommand(repoPath: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const cmd = `git ${args.join(' ')}`;
		exec(cmd, { cwd: repoPath }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

class SuggestionContentProvider implements vscode.TextDocumentContentProvider {
	// A map to store the content of our virtual documents.
	// The key is the URI as a string, and the value is the document content.
	private readonly content = new Map<string, string>();

	// This method is called by VS Code when it needs to display our virtual document.
	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.content.get(uri.toString()) || '';
	}

	/**
	 * Sets the content for a given URI. This is how we'll tell the provider
	 * what to show for the original and suggested code.
	 * @param uri The virtual document URI.
	 * @param value The content of the virtual document.
	 */
	setContent(uri: vscode.Uri, value: string): void {
		this.content.set(uri.toString(), value);
	}

	/**
	 * Deletes the content for a given URI. This is important for cleanup.
	 * @param uri The virtual document URI to clean up.
	 */
	deleteContent(uri: vscode.Uri): void {
		this.content.delete(uri.toString());
	}
}
class OllamaSuggestionProvider implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.Refactor,
		// Let's also include QuickFix, as the lightbulb is often associated with it.
		vscode.CodeActionKind.QuickFix
	];

	/**
	 * This method is called by VS Code to provide code actions.
	 * @param document The document in which the command was invoked.
	 * @param range The selected range of text.
	 * @returns An array of CodeAction objects.
	 */
	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] | undefined {
		console.log(`[OllamaSuggestionProvider] provideCodeActions called. Is range empty? ${range.isEmpty}`);
		// Don't show the action if the selection is empty.
		if (range.isEmpty) {
			return;
		}

		// Create a new CodeAction with a title that will appear in the menu.
		const refactorAction = new vscode.CodeAction('Ollama: Suggest Refactoring', OllamaSuggestionProvider.providedCodeActionKinds[0]);

		// Assign the command that should be executed when the user selects this action.
		// This links the UI action to your existing command implementation.
		refactorAction.command = {
			command: 'ollama-code-review.suggestRefactoring',
			title: 'Suggest a refactoring for the selected code',
			tooltip: 'Asks Ollama for a suggestion to improve the selected code.'
		};

		refactorAction.isPreferred = true;

		const diagnostic = new vscode.Diagnostic(
			range,
			'Select code to get a refactoring suggestion from Ollama.',
			vscode.DiagnosticSeverity.Hint
		);
		refactorAction.diagnostics = [diagnostic];

		console.log("[OllamaSuggestionProvider] Range is NOT empty, returning a CodeAction.");
		return [refactorAction];
	}
}

/**
 * Updates the status bar item to show the current model
 */
function updateModelStatusBar(statusBarItem: vscode.StatusBarItem) {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	// Show just the base model name for cleaner look
	const displayModel = model;
	statusBarItem.text = `$(hubot) ${displayModel}`;
	statusBarItem.tooltip = `Ollama Model: ${model}\nClick to switch model`;
}

const distinctByProperty = <T, K extends keyof T>(arr: T[], prop: K): T[] => {
	const seen = new Set<T[K]>();
	return arr.filter(item => {
		const val = item[prop];
		if (seen.has(val)) {
			return false;
		}
		seen.add(val);
		return true;
	});
};

export async function activate(context: vscode.ExtensionContext) {
	const skillsService = await SkillsService.create(context);
	outputChannel = vscode.window.createOutputChannel("Ollama Code Review");
	const suggestionProvider = new SuggestionContentProvider();

	// Create status bar item for model selection (appears in bottom status bar)
	const modelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	modelStatusBarItem.command = 'ollama-code-review.selectModel';
	updateModelStatusBar(modelStatusBarItem);
	modelStatusBarItem.show();
	context.subscriptions.push(modelStatusBarItem);

	// Register model selection command
	const selectModelCommand = vscode.commands.registerCommand('ollama-code-review.selectModel', async () => {
		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const currentModel = getOllamaModel(config);

		// Cloud models (remote APIs) that won't appear in local Ollama
		const cloudModels = [
			{ label: 'kimi-k2.5:cloud', description: 'Kimi cloud model (Default)' },
			{ label: 'qwen3-coder:480b-cloud', description: 'Cloud coding model' },
			{ label: 'glm-4.7:cloud', description: 'GLM cloud model' },
			{ label: 'glm-4.7-flash', description: 'GLM 4.7 Flash - Free tier (Z.AI)' },
			{ label: 'claude-sonnet-4-20250514', description: 'Claude Sonnet 4 (Anthropic)' },
			{ label: 'claude-opus-4-20250514', description: 'Claude Opus 4 (Anthropic)' },
			{ label: 'claude-3-7-sonnet-20250219', description: 'Claude 3.7 Sonnet (Anthropic)' }
		];

		try {
			// Derive the tags endpoint from the configured generate endpoint
			const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
			const baseUrl = endpoint.replace(/\/api\/generate\/?$/, '').replace(/\/$/, '');
			const tagsUrl = `${baseUrl}/api/tags`;

			// Fetch with timeout
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 5000);

			const response = await fetch(tagsUrl, { signal: controller.signal });
			clearTimeout(timeout);

			if (!response.ok) {
				throw new Error(`${response.status}: ${response.statusText}`);
			}

			const data = await response.json() as {
				models: Array<{
					name: string;
					modified_at?: string;
					size?: number;
					details?: {
						parameter_size?: string;
						family?: string;
						format?: string;
						quantized_level?: string;
					}
				}>
			};

			// Transform Ollama models to QuickPick items
			const localModels = data.models.map((model) => {
				const details: string[] = [];

				if (model.details?.family) {
					details.push(model.details.family);
				}
				if (model.details?.parameter_size) {
					details.push(model.details.parameter_size);
				}
				if (model.size) {
					const sizeGB = (model.size / (1024 ** 3)).toFixed(1);
					details.push(`${sizeGB}GB`);
				}

				return {
					label: model.name,
					description: details.join(' • ') || 'Local Ollama model'
				};
			});

			// Sort alphabetically
			localModels.sort((a, b) => a.label.localeCompare(b.label));

			// Combine cloud + local + custom
			const models = distinctByProperty([
				...cloudModels,
				...localModels,
				{ label: 'custom', description: 'Use custom model from settings' }
			], 'label');

			const currentItem = models.find(m => m.label === currentModel);
			const selected = await vscode.window.showQuickPick(models, {
				placeHolder: `Current: ${currentItem?.label || currentModel || 'None'} | Select Ollama model`,
				matchOnDescription: true
			});

			if (selected) {
				await config.update('model', selected.label, vscode.ConfigurationTarget.Global);
				updateModelStatusBar(modelStatusBarItem);
				vscode.window.showInformationMessage(`Ollama model changed to: ${selected.label}`);
			}

		} catch (error) {
			// Fallback if Ollama is not running
			vscode.window.showWarningMessage(
				`Could not connect to Ollama (${error}). Showing available cloud options.`
			);

			const fallbackModels = [
				...cloudModels,
				{ label: 'custom', description: 'Use custom model from settings' }
			];

			// Add current model to list if it's not already there
			if (currentModel && !fallbackModels.find(m => m.label === currentModel)) {
				fallbackModels.unshift({
					label: currentModel,
					description: 'Currently configured'
				});
			}

			const currentItem = fallbackModels.find(m => m.label === currentModel);
			const selected = await vscode.window.showQuickPick(fallbackModels, {
				placeHolder: `Current: ${currentItem?.label || currentModel || 'None'} | Select model (Ollama unreachable)`
			});

			if (selected) {
				await config.update('model', selected.label, vscode.ConfigurationTarget.Global);
				updateModelStatusBar(modelStatusBarItem);
				vscode.window.showInformationMessage(`Ollama model changed to: ${selected.label}`);
			}
		}
	});

	context.subscriptions.push(selectModelCommand);

	// Listen for configuration changes to update status bar
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('ollama-code-review.model') ||
				e.affectsConfiguration('ollama-code-review.customModel')) {
				updateModelStatusBar(modelStatusBarItem);
			}
		})
	);

	const browseSkillsCommand = vscode.commands.registerCommand(
		'ollama-code-review.browseAgentSkills',
		async () => {
			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Loading Agent Skills',
					cancellable: false
				}, async (progress) => {
					progress.report({ message: 'Fetching skills from GitHub...' });

					const skills = await skillsService.fetchAvailableSkills();

					progress.report({ message: 'Opening skills browser...' });
					await SkillsBrowserPanel.createOrShow(skillsService, skills);
				});
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to load agent skills: ${error}`
				);
			}
		}
	);

	// Apply Skill to Code Review Command
	const applySkillCommand = vscode.commands.registerCommand(
		'ollama-code-review.applySkillToReview',
		async () => {
			const cachedSkills = skillsService.listCachedSkills();

			if (cachedSkills.length === 0) {
				const browse = await vscode.window.showInformationMessage(
					'No skills installed. Would you like to browse available skills?',
					'Browse Skills',
					'Cancel'
				);

				if (browse === 'Browse Skills') {
					vscode.commands.executeCommand('ollama-code-review.browseAgentSkills');
				}
				return;
			}

			const selectedSkill = await vscode.window.showQuickPick(
				cachedSkills.map(skill => ({
					label: skill.name,
					description: skill.description,
					skill: skill
				})),
				{ placeHolder: 'Select a skill to apply to code review' }
			);

			if (selectedSkill) {
				vscode.window.showInformationMessage(
					`Skill "${selectedSkill.skill.name}" will be applied to next review`
				);
				// Store selected skill for next review
				context.globalState.update('selectedSkill', selectedSkill.skill);
			}
		}
	);

	context.subscriptions.push(browseSkillsCommand, applySkillCommand);
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider('ollama-suggestion', suggestionProvider)
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('*', new OllamaSuggestionProvider(), {
			providedCodeActionKinds: OllamaSuggestionProvider.providedCodeActionKinds
		})
	);


	const reviewStagedChangesCommand = vscode.commands.registerCommand('ollama-code-review.reviewChanges', async (scmRepo?: any) => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			let repo: any;
			if (scmRepo) {
				repo = scmRepo;
			} else {
				repo = await selectRepository(gitAPI);
			}
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;
			const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);
			await runReview(diffResult, context);
		} catch (error) {
			handleError(error, "Failed to review staged changes.");
		}
	});

	const reviewCommitCommand = vscode.commands.registerCommand('ollama-code-review.reviewCommit', async (commitOrUri?: any) => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }

			let repo: any;
			let commitHash: string | undefined;

			// Handle different invocation contexts
			if (commitOrUri) {
				// Called from Git Graph or SCM context menu with commit info
				if (commitOrUri.hash) {
					// Git Graph format
					commitHash = commitOrUri.hash;
					repo = gitAPI.repositories.find((r: any) =>
						commitOrUri.repoRoot && r.rootUri.fsPath === commitOrUri.repoRoot
					) || await selectRepository(gitAPI);
				} else if (commitOrUri.rootUri) {
					// SCM repository context
					repo = commitOrUri;
				}
			}

			if (!repo) {
				repo = await selectRepository(gitAPI);
			}

			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}

			const repoPath = repo.rootUri.fsPath;

			// If we don't have a commit hash yet, prompt for it or show a picker
			if (!commitHash) {
				const inputHash = await vscode.window.showInputBox({
					prompt: 'Enter commit hash to review (or leave empty to select from recent commits)',
					placeHolder: 'e.g., abc123 or HEAD~1'
				});

				if (inputHash === undefined) { return; } // User cancelled

				if (inputHash.trim()) {
					commitHash = inputHash.trim();
				} else {
					// Show commit picker
					await vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: 'Loading commits...',
						cancellable: false
					}, async () => {
						const log = await repo.log({ maxEntries: 50 }) as GitCommitDetails[];

						const quickPickItems: CommitQuickPickItem[] = log.map(commit => ({
							label: `$(git-commit) ${commit.message.split('\n')[0]}`,
							description: `${commit.hash.substring(0, 7)} by ${commit.authorName || 'Unknown'}`,
							detail: commit.commitDate ? new Date(commit.commitDate).toLocaleString() : '',
							hash: commit.hash
						}));

						const selected = await vscode.window.showQuickPick(quickPickItems, {
							placeHolder: 'Select a commit to review',
							matchOnDescription: true
						});

						if (selected) {
							commitHash = selected.hash;
						}
					});
				}
			}

			if (!commitHash) { return; }

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama Code Review',
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: `Getting commit details for ${commitHash!.substring(0, 7)}...` });

				// Get commit details
				const commitDetails = await repo.getCommit(commitHash);
				if (token.isCancellationRequested) { return; }

				progress.report({ message: 'Generating diff...' });

				let diffResult: string;
				let parentHashOrEmptyTree: string;

				// Handle initial commit (no parents) vs regular commits
				if (commitDetails.parents.length > 0) {
					parentHashOrEmptyTree = commitDetails.parents[0];
					diffResult = await runGitCommand(repoPath, ['diff', `${parentHashOrEmptyTree}..${commitHash}`]);
				} else {
					// Initial commit - compare against empty tree
					parentHashOrEmptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
					diffResult = await runGitCommand(repoPath, ['diff', parentHashOrEmptyTree, commitHash as unknown as string]);
				}

				if (token.isCancellationRequested) { return; }

				// Get list of changed files for logging
				const filesList = await runGitCommand(repoPath, ['diff', '--name-only', parentHashOrEmptyTree, commitHash as unknown as string]);
				const filesArray = filesList.trim().split('\n').filter(Boolean);

				outputChannel.appendLine(`\n--- Reviewing Commit: ${commitHash!.substring(0, 7)} ---`);
				outputChannel.appendLine(`Commit Message: ${commitDetails.message.split('\n')[0]}`);
				outputChannel.appendLine(`Author: ${commitDetails.authorName || 'Unknown'}`);
				outputChannel.appendLine(`Changed files (${filesArray.length}):`);
				filesArray.forEach(f => outputChannel.appendLine(`  - ${f}`));
				outputChannel.appendLine('---------------------------------------');

				progress.report({ message: 'Running review...' });
				await runReview(diffResult, context);
			});

		} catch (error) {
			handleError(error, 'Failed to review commit.');
		}
	});

	const reviewCommitRangeCommand = vscode.commands.registerCommand('ollama-code-review.reviewCommitRange', async () => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			const repo = await selectRepository(gitAPI);
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;

			const commitToRef = (await vscode.window.showInputBox({
				prompt: "Enter the newest commit or branch to include in the review (e.g., HEAD)",
				placeHolder: "Default: HEAD",
				value: "HEAD"
			}))?.trim();

			if (!commitToRef) { return; }

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Ollama Code Review",
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: "Fetching commit history..." });
				const log = await repo.log({ maxEntries: 100, range: commitToRef }) as GitCommitDetails[];
				if (token.isCancellationRequested) { return; }

				const quickPickItems: CommitQuickPickItem[] = log.map(commit => ({
					label: `$(git-commit) ${commit.message.split('\n')[0]}`,
					description: `${commit.hash.substring(0, 7)} by ${commit.authorName || 'Unknown'}`,
					detail: commit.commitDate ? new Date(commit.commitDate).toLocaleString() : '',
					hash: commit.hash
				}));

				progress.report({ message: "Awaiting your selection..." });
				const selectedStartCommit = await vscode.window.showQuickPick(quickPickItems, {
					placeHolder: "Select the first commit to INCLUDE in the review (the base of your changes)",
					canPickMany: false,
					matchOnDescription: true
				});

				if (!selectedStartCommit || token.isCancellationRequested) { return; }

				const startCommitDetails = await repo.getCommit(selectedStartCommit.hash);

				progress.report({ message: 'Generating diff using git...' });

				let diffResult: string;
				let parentHashOrEmptyTree: string;

				if (startCommitDetails.parents.length > 0) {
					parentHashOrEmptyTree = startCommitDetails.parents[0];
					diffResult = await runGitCommand(repoPath, ['diff', parentHashOrEmptyTree, commitToRef]);
				} else {
					parentHashOrEmptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // empty tree hash
					outputChannel.appendLine(`Info: Initial commit selected. Diffing all changes up to ${commitToRef}.`);
					diffResult = await runGitCommand(repoPath, ['diff', parentHashOrEmptyTree, commitToRef]);
				}

				// Get changed files list and show in output channel
				const filesList = await runGitCommand(repoPath, ['diff', '--name-only', parentHashOrEmptyTree, commitToRef]);
				const filesArray = filesList.trim().split('\n').filter(Boolean);

				outputChannel.appendLine(`\n--- Changed files in selected range (${filesArray.length}) ---`);
				filesArray.forEach(f => outputChannel.appendLine(f));
				outputChannel.appendLine('---------------------------------------');

				await runReview(diffResult, context);
			});

		} catch (error) {
			handleError(error, `Failed to generate commit diff.`);
		}
	});

	const reviewChangesBetweenTwoBranchesCommand = vscode.commands.registerCommand('ollama-code-review.reviewChangesBetweenTwoBranches', async () => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			const repo = await selectRepository(gitAPI);
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;

			const fromRef = await vscode.window.showInputBox({
				prompt: 'Enter the base branch/ref to compare from (e.g., main)',
				placeHolder: 'main',
				value: 'main'
			});
			if (!fromRef) { return; }

			const toRef = await vscode.window.showInputBox({
				prompt: 'Enter the target branch/ref to compare to (e.g., feature-branch)',
				placeHolder: 'feature-branch',
			});
			if (!toRef) { return; }

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama Code Review',
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: `Generating diff between ${fromRef} and ${toRef}...` });

				const diffResult = await runGitCommand(repoPath, ['diff', fromRef, toRef]);
				if (token.isCancellationRequested) { return; }

				const filesList = await runGitCommand(repoPath, ['diff', '--name-only', fromRef, toRef]);
				const filesArray = filesList.trim().split('\n').filter(Boolean);

				outputChannel.appendLine(`\n--- Changed files between ${fromRef} and ${toRef} (${filesArray.length}) ---`);
				filesArray.forEach(f => outputChannel.appendLine(f));
				outputChannel.appendLine('---------------------------------------');

				await runReview(diffResult, context);
			});
		} catch (error) {
			handleError(error, 'Failed to review changes between branches.');
		}
	});

	const generateCommitMessageCommand = vscode.commands.registerCommand('ollama-code-review.generateCommitMessage', async (scmRepo?: any) => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			let repo: any;
			if (scmRepo) {
				repo = scmRepo;
			} else {
				repo = await selectRepository(gitAPI);
			}

			const repoPath = repo.rootUri.fsPath;
			const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);

			if (!diffResult || !diffResult.trim()) {
				vscode.window.showInformationMessage('No staged changes to create a commit message from.');
				return;
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Ollama",
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: "Generating commit message..." });

				const commitMessage = await getOllamaCommitMessage(diffResult, repo.inputBox.value?.trim());
				if (token.isCancellationRequested) { return; }

				if (commitMessage) {
					repo.inputBox.value = commitMessage;
					vscode.window.showInformationMessage('Commit message generated and populated!');
				} else {
					vscode.window.showErrorMessage('Failed to generate commit message.');
				}
			});

		} catch (error) {
			handleError(error, "Failed to generate commit message.");
		}
	});

	// Put this inside the activate function, replacing the old suggestRefactoringCommand
	const suggestRefactoringCommand = vscode.commands.registerCommand('ollama-code-review.suggestRefactoring', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select a code snippet to get a suggestion.');
			return;
		}

		// Define unique URIs for our virtual documents. A timestamp ensures they are new each time.
		const timestamp = new Date().getTime();
		const originalUri = vscode.Uri.parse(`ollama-suggestion:original/${path.basename(editor.document.fileName)}?ts=${timestamp}`);
		const suggestedUri = vscode.Uri.parse(`ollama-suggestion:suggestion/${path.basename(editor.document.fileName)}?ts=${timestamp}`);

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Window,
				title: "Ollama: Getting suggestion...",
				cancellable: true
			}, async (progress, token) => {
				const languageId = editor.document.languageId;
				const rawSuggestion = await getOllamaSuggestion(selectedText, languageId);
				if (token.isCancellationRequested) { return; }

				const parsed = parseSuggestion(rawSuggestion);

				if (!parsed) {
					vscode.window.showErrorMessage('Ollama returned a response in an unexpected format.');
					outputChannel.appendLine("--- Unexpected Ollama Response ---");
					outputChannel.appendLine(rawSuggestion);
					outputChannel.show();
					return;
				}

				const { code: suggestedCode, explanation } = parsed;

				// Set the content for our virtual documents via the provider
				suggestionProvider.setContent(originalUri, selectedText);
				suggestionProvider.setContent(suggestedUri, suggestedCode);

				const diffTitle = `Ollama Suggestion for ${path.basename(editor.document.fileName)}`;

				// Execute the built-in diff command
				vscode.commands.executeCommand('vscode.diff', originalUri, suggestedUri, diffTitle, {
					preview: true, // Show in a peek view, not a new editor tab
					viewColumn: vscode.ViewColumn.Beside, // Prefer showing beside the current editor
				});

				// Use a non-modal message for actions, now including the explanation.
				const userChoice = await vscode.window.showInformationMessage(
					explanation,
					{ modal: false }, // Explicitly non-modal
					"Apply Suggestion",
					"Dismiss"
				);

				if (userChoice === "Apply Suggestion") {
					editor.edit(editBuilder => {
						editBuilder.replace(selection, suggestedCode);
					});
					vscode.window.showInformationMessage('Suggestion applied!');
				}
			});
		} catch (error) {
			handleError(error, "Failed to get suggestion.");
		} finally {
			// CRITICAL: Always clean up the virtual document content to free memory.
			suggestionProvider.deleteContent(originalUri);
			suggestionProvider.deleteContent(suggestedUri);
		}
	});

	context.subscriptions.push(
		reviewStagedChangesCommand,
		reviewCommitRangeCommand,
		reviewChangesBetweenTwoBranchesCommand,
		generateCommitMessageCommand,
		suggestRefactoringCommand,
		reviewCommitCommand
	);
}

function getGitAPI() {
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension) {
		vscode.window.showErrorMessage('Git extension not found. Please ensure it is enabled.');
		return undefined;
	}
	return gitExtension.getAPI(1);
}

async function runReview(diff: string, context: vscode.ExtensionContext) {
	if (!diff || !diff.trim()) {
		vscode.window.showInformationMessage('No code changes found to review in the selected range.');
		return;
	}

	// Apply diff filtering
	const filterResult = filterDiff(diff);
	const filteredDiff = filterResult.filteredDiff;

	if (!filteredDiff || !filteredDiff.trim()) {
		vscode.window.showInformationMessage('All changes were filtered out (lock files, build outputs, etc.). No code to review.');
		return;
	}

	// Show filter summary if files were filtered
	const filterSummary = getFilterSummary(filterResult.stats);
	if (filterSummary) {
		outputChannel.appendLine(`\n--- Diff Filter ---`);
		outputChannel.appendLine(filterSummary);
		outputChannel.appendLine(`Reviewing ${filterResult.stats.includedFiles} of ${filterResult.stats.totalFiles} files`);
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Ollama Code Review",
		cancellable: false
	}, async (progress) => {
		progress.report({ message: `Asking Ollama for a review (${filterResult.stats.includedFiles} files)...` });
		const review = await getOllamaReview(filteredDiff, context);

		progress.report({ message: "Displaying review..." });
		OllamaReviewPanel.createOrShow(review, filteredDiff, context);
	});
}

async function getOllamaReview(diff: string, context?: vscode.ExtensionContext): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0);
	const frameworks = config.get<string[] | string>('frameworks', ['React']);
	const frameworksList = Array.isArray(frameworks)
		? frameworks.join(', ')
		: typeof frameworks === 'string'
			? frameworks
			: 'React';
	let skillContext = '';

	if (context) {
		const selectedSkill = context.globalState.get<any>('selectedSkill');
		if (selectedSkill) {
			skillContext = `\n\nAdditional Review Guidelines:\n${selectedSkill.content}\n`;
		}
	}

	const prompt = `
		You are an expert software engineer and code reviewer with deep knowledge of the following frameworks and libraries: **${frameworksList}**.
		Your task is to analyze the following code changes (in git diff format) and provide constructive, actionable feedback tailored to the conventions, best practices, and common pitfalls of these technologies.
		${skillContext}
		**How to Read the Git Diff Format:**
		- Lines starting with \`---\` and \`+++\` indicate the file names before and after the changes.
		- Lines starting with \`@@\` (e.g., \`@@ -15,7 +15,9 @@\`) denote the location of the changes within the file.
		- Lines starting with a \`-\` are lines that were DELETED.
		- Lines starting with a \`+\` are lines that were ADDED.
		- Lines without a prefix (starting with a space) are for context and have not been changed. **Please focus your review on the added (\`+\`) and deleted (\`-\`) lines.**

		**Review Focus:**
		- Potential bugs or logical errors specific to the frameworks/libraries (${frameworksList}).
		- Performance optimizations, considering framework-specific patterns.
		- Code style inconsistencies or deviations from ${frameworksList} best practices.
		- Security vulnerabilities, especially those common in ${frameworksList}.
		- Improvements to maintainability and readability, aligned with ${frameworksList} conventions.

		**Feedback Requirements:**
		1. Explain any issues clearly and concisely, referencing ${frameworksList} where relevant.
		2. Suggest specific code changes or improvements. Include code snippets for examples where appropriate.
		3. Use Markdown for clear formatting.

		If you find no issues, please respond with the single sentence: "I have reviewed the changes and found no significant issues."

		Here is the code diff to review:
		---
		${diff}
		---
		`;


	try {
		// Use Claude API if a Claude model is selected
		if (isClaudeModel(model)) {
			return await callClaudeAPI(prompt, config);
		}

		// Use GLM API if a GLM model is selected
		if (isGlmModel(model)) {
			return await callGlmAPI(prompt, config);
		}

		// Otherwise use Ollama API
		const response = await axios.post(endpoint, {
			model: model,
			prompt: prompt,
			stream: false,
			options: { temperature }
		});
		return response.data.response.trim();
	} catch (error) {
		throw error;
	}
}

async function getOllamaCommitMessage(diff: string, existingMessage?: string): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.2); // Slightly more creative for commit messages

	const prompt = `
        You are an expert at writing git commit messages for Semantic Release.
        Generate a commit message based on the git diff below following the Conventional Commits specification.

        ### Structural Requirements:
        1. **Subject Line**: <type>(<scope>): <short description>
           - Keep under 50 characters.
           - Use imperative mood ("add" not "added").
           - Types: feat (new feature), fix (bug fix), docs, style, refactor, perf, test, build, ci, chore, revert.
        2. **Body**: Explain 'what' and 'why'. Required if the change is complex.
        3. **Breaking Changes**: If the diff contains breaking changes, the footer MUST start with "BREAKING CHANGE:" followed by a description.

        ### Rules:
        - If the user's draft mentions a breaking change, prioritize documenting it in the footer.
        - Semantic Release triggers: 'feat' for MINOR, 'fix' for PATCH, and 'BREAKING CHANGE' in footer for MAJOR.
        - Output ONLY the raw commit message text. No markdown blocks, no "Here is your message," no preamble.

		Developer's draft message (may reflect intent):
		${existingMessage && existingMessage.trim() ? existingMessage : "(none provided)"}

        Staged git diff:
        ---
        ${diff}
        ---
        `;

	try {
		let message: string;

		// Use Claude API if a Claude model is selected
		if (isClaudeModel(model)) {
			message = await callClaudeAPI(prompt, config);
		} else if (isGlmModel(model)) {
			// Use GLM API if a GLM model is selected
			message = await callGlmAPI(prompt, config);
		} else {
			// Otherwise use Ollama API
			const response = await axios.post(endpoint, {
				model: model,
				prompt: prompt,
				stream: false,
				options: { temperature }
			});
			message = response.data.response.trim();
		}

		// Sometimes models add quotes or markdown blocks around the message, so we trim them.
		if (message.startsWith('```') && message.endsWith('```')) {
			message = message.substring(3, message.length - 3).trim();
		}
		if ((message.startsWith('"') && message.endsWith('"')) || (message.startsWith("'") && message.endsWith("'"))) {
			message = message.substring(1, message.length - 1);
		}
		return message;
	} catch (error) {
		throw error;
	}
}

async function getOllamaSuggestion(codeSnippet: string, languageId: string): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.3);

	const prompt = `
		You are an expert software engineer specializing in writing clean, efficient, and maintainable code.
		Your task is to analyze the following ${languageId} code snippet and provide a refactored or improved version.

		**IMPORTANT:** Your response MUST follow this structure exactly:
		1.  Start your response with the refactored code inside a markdown code block (e.g., \`\`\`${languageId}\n...\n\`\`\`).
		2.  IMMEDIATELY after the code block, provide a clear, bulleted list explaining the key improvements you made.

		If the code is already well-written and you have no suggestions, respond with the single sentence: "The selected code is well-written and I have no suggestions for improvement."

		Here is the code to refactor:
		---
		${codeSnippet}
		---
	`;

	try {
		// Use Claude API if a Claude model is selected
		if (isClaudeModel(model)) {
			return await callClaudeAPI(prompt, config);
		}

		// Use GLM API if a GLM model is selected
		if (isGlmModel(model)) {
			return await callGlmAPI(prompt, config);
		}

		// Otherwise use Ollama API
		const response = await axios.post(endpoint, {
			model: model,
			prompt: prompt,
			stream: false,
			options: { temperature }
		});
		return response.data.response.trim();
	} catch (error) {
		throw error;
	}
}

function handleError(error: unknown, contextMessage: string) {
	let errorMessage = `${contextMessage}\n`;
	if (error && typeof error === 'object' && 'stderr' in error && (error as any).stderr) {
		errorMessage += `Git Error: ${(error as any).stderr}`;
	} else if (axios.isAxiosError(error)) {
		errorMessage += `Ollama API Error: ${error.message}. Is Ollama running? Check the endpoint in settings.`;
	} else if (error instanceof Error) {
		errorMessage += `An unexpected error occurred: ${error.message}`;
	} else {
		errorMessage += `An unexpected error occurred: ${String(error)}`;
	}

	vscode.window.showErrorMessage(errorMessage, { modal: true });
	console.error(error);

	outputChannel.appendLine("\n--- ERROR ---");
	outputChannel.appendLine(errorMessage);
	outputChannel.show(true);
}

export function deactivate() {
	if (outputChannel) {
		outputChannel.dispose();
	}
}
