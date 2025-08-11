import * as vscode from 'vscode';
import axios from 'axios';

// This will hold our output channel for displaying the review
let outputChannel: vscode.OutputChannel;
type ChangeType = { uri: { fsPath: string }};

export function activate(context: vscode.ExtensionContext) {
	// Create an output channel to display the code review
	outputChannel = vscode.window.createOutputChannel("Ollama Code Review");

	// Register our command
	const disposable = vscode.commands.registerCommand('ollama-code-review.reviewChanges', async () => {

		// Show a progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Ollama Code Review",
			cancellable: false
		}, async (progress) => {
			progress.report({ message: "Getting staged changes..." });

			try {
				// 1. Get the Git API
				const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
				if (!gitExtension) {
					vscode.window.showErrorMessage('Git extension not found. Please ensure it is enabled.');
					return;
				}
				const api = gitExtension.getAPI(1);

				// 2. Get the current repository
				// We'll just use the first repository for simplicity
				const repo = api.repositories[0];
				if (!repo) {
					vscode.window.showInformationMessage('No Git repository found in the current workspace.');
					return;
				}

				// 3. Get the staged changes (the diff)
				const stagedChanges = await repo.diffIndexWith('HEAD');
				if (stagedChanges.length === 0) {
					vscode.window.showInformationMessage('No staged changes found to review.');
					return;
				}

				// Concatenate all diffs into a single string
				const diffText = stagedChanges.map((change: ChangeType) => {
					// We need to get the actual diff content for each file
					return repo.diffIndexWith('HEAD', change.uri.fsPath);
				}).join('\n');

				const fullDiff = await Promise.all(stagedChanges.map((change: ChangeType) => repo.diffIndexWith('HEAD', change.uri.fsPath))).then(diffs => diffs.join('\n'));

				progress.report({ message: "Asking Ollama for a review..." });

				// 4. Call Ollama with the diff
				const review = await getOllamaReview(fullDiff);

				// 5. Display the review
				progress.report({ message: "Displaying review..." });
				outputChannel.clear();
				outputChannel.appendLine("--- Ollama Code Review ---");
				outputChannel.appendLine(review);
				outputChannel.show(true); // Bring the output channel to the front

			} catch (error) {
				if (axios.isAxiosError(error)) {
					vscode.window.showErrorMessage(`Ollama API Error: ${error.message}. Is Ollama running?`);
				} else {
					vscode.window.showErrorMessage(`An unexpected error occurred: ${error}`);
				}
				console.error(error);
			}
		});
	});

	context.subscriptions.push(disposable);
}

async function getOllamaReview(diff: string): Promise<string> {
	// Get configuration settings
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = config.get<string>('model', 'llama3');
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');

	// Construct a high-quality prompt
	const prompt = `
        You are an expert code reviewer. Your task is to analyze the following code changes (in git diff format) and provide constructive feedback.
        Focus on potential bugs, performance issues, style inconsistencies, and best practices.
        Do not comment on minor stylistic choices unless they significantly impact readability.
        Provide your feedback in a clear, concise, and actionable list format.

        Here is the code diff to review:
        ---
        ${diff}
        ---
    `;

	// Make the API call to Ollama
	const response = await axios.post(endpoint, {
		model: model,
		prompt: prompt,
		stream: false // We want the full response at once
	});

	return response.data.response.trim();
}

export function deactivate() {
	if (outputChannel) {
		outputChannel.dispose();
	}
}