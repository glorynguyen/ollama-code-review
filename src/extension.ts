import * as vscode from 'vscode';
import axios from 'axios';
import { exec } from 'child_process';

let outputChannel: vscode.OutputChannel;

// We need a detailed interface to access parent hashes
interface GitCommitDetails {
	hash: string;
	message: string;
	parents: string[];
	authorName?: string;
	commitDate?: Date;
}

// Custom QuickPickItem that holds the full commit hash
interface CommitQuickPickItem extends vscode.QuickPickItem {
	hash: string;
}

/**
 * Runs a git command with arguments in the given repo path.
 * Returns stdout string or throws on error.
 */
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

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel("Ollama Code Review");

	// Command 1: Review STAGED changes
	const reviewStagedChangesCommand = vscode.commands.registerCommand('ollama-code-review.reviewChanges', async () => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) return;
			const repo = gitAPI.repositories[0];
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;
			const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);
			await runReview(diffResult);

		} catch (error) {
			handleError(error, "Failed to review staged changes.");
		}
	});

	// Command 2: Interactively select a commit range to review
	const reviewCommitRangeCommand = vscode.commands.registerCommand('ollama-code-review.reviewCommitRange', async () => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) return;
			const repo = gitAPI.repositories[0];
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;

			// 1. Prompt for the "end" commit (the newer one)
			const commitToRef = (await vscode.window.showInputBox({
				prompt: "Enter the newest commit or branch to include in the review (e.g., HEAD)",
				placeHolder: "Default: HEAD",
				value: "HEAD"
			}))?.trim();

			if (!commitToRef) return;

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Ollama Code Review",
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: "Fetching commit history..." });
				const log = await repo.log({ maxEntries: 100, range: commitToRef }) as GitCommitDetails[];
				if (token.isCancellationRequested) return;

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

				if (!selectedStartCommit || token.isCancellationRequested) return;

				const startCommitDetails = await repo.getCommit(selectedStartCommit.hash);

				let diffResult: string;

				progress.report({ message: 'Generating diff using git...' });

				if (startCommitDetails.parents.length > 0) {
					// Standard case: the commit has a parent. Diff from the parent to the end ref.
					const parentHash = startCommitDetails.parents[0];
					diffResult = await runGitCommand(repoPath, ['diff', parentHash, commitToRef]);
				} else {
					// Edge case: the selected commit is the initial commit (no parents).
					// We diff the entire history up to the end ref against git's "empty tree" hash.
					const emptyTreeHash = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
					outputChannel.appendLine(`Info: Initial commit selected. Diffing all changes up to ${commitToRef}.`);
					diffResult = await runGitCommand(repoPath, ['diff', emptyTreeHash, commitToRef]);
				}

				await runReview(diffResult);
			});

		} catch (error) {
			handleError(error, `Failed to generate commit diff.`);
		}
	});

	context.subscriptions.push(reviewStagedChangesCommand, reviewCommitRangeCommand);
}

/**
 * A helper function to get the Git extension API.
 */
function getGitAPI() {
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension) {
		vscode.window.showErrorMessage('Git extension not found. Please ensure it is enabled.');
		return undefined;
	}
	return gitExtension.getAPI(1);
}

/**
 * This function takes a diff string and handles the review process.
 */
async function runReview(diff: string) {
	if (!diff || !diff.trim()) {
		vscode.window.showInformationMessage('No code changes found to review in the selected range.');
		return;
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Ollama Code Review",
		cancellable: false
	}, async (progress) => {
		progress.report({ message: "Asking Ollama for a review..." });
		const review = await getOllamaReview(diff);

		progress.report({ message: "Displaying review..." });
		outputChannel.clear();
		outputChannel.appendLine("--- Ollama Code Review ---");
		outputChannel.appendLine(review);
		outputChannel.show(true);
	});
}

/**
 * Sends the diff to Ollama and returns the review.
 */
async function getOllamaReview(diff: string): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = config.get<string>('model', 'llama3');
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');

	const prompt = `
        You are an expert code reviewer. Your task is to analyze the following code changes (in git diff format) and provide constructive feedback.
        Focus on potential bugs, performance issues, style inconsistencies, and best practices.
        Do not comment on minor stylistic choices unless they significantly impact readability.
        Provide your feedback in a clear, concise, and actionable list format. If there are no issues, simply say "No issues found.".

        Here is the code diff to review:
        ---
        ${diff}
        ---
    `;

	try {
		const response = await axios.post(endpoint, {
			model: model,
			prompt: prompt,
			stream: false,
			options: { temperature: 0.2 }
		});
		return response.data.response.trim();
	} catch (error) {
		throw error;
	}
}

/**
 * A centralized error handler.
 */
function handleError(error: unknown, contextMessage: string) {
	let errorMessage = `${contextMessage}\n`;
	// `repo.run` can throw an error object that contains stderr for git failures.
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
