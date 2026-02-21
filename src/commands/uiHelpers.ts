import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import { getOllamaModel } from '../utils';
import { getActiveProfile } from '../profiles';

export async function selectRepository(gitAPI: any): Promise<any | undefined> {
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
export function parseSuggestion(response: string): { code: string; explanation: string } | null {
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

export function runGitCommand(repoPath: string, args: string[]): Promise<string> {
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

export class SuggestionContentProvider implements vscode.TextDocumentContentProvider {
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
export class OllamaSuggestionProvider implements vscode.CodeActionProvider {

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
export function updateModelStatusBar(statusBarItem: vscode.StatusBarItem) {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	// Show just the base model name for cleaner look
	const displayModel = model;
	statusBarItem.text = `$(hubot) ${displayModel}`;
	statusBarItem.tooltip = `Ollama Model: ${model}\nClick to switch model`;
}

export function updateProfileStatusBar(statusBarItem: vscode.StatusBarItem, context: vscode.ExtensionContext) {
	const profile = getActiveProfile(context);
	statusBarItem.text = `$(shield) ${profile.name}`;
	statusBarItem.tooltip = `Review Profile: ${profile.name}\n${profile.description}\nClick to switch profile`;
}

export const distinctByProperty = <T, K extends keyof T>(arr: T[], prop: K): T[] => {
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

// Constants for global state keys
const HF_RECENT_MODELS_KEY = 'hfRecentModels';
const MAX_RECENT_MODELS = 5;

/**
 * Get recently used Hugging Face models from global state
 */
function getRecentHfModels(context: vscode.ExtensionContext): string[] {
	return context.globalState.get<string[]>(HF_RECENT_MODELS_KEY, []);
}

/**
 * Add a model to the recent HF models list
 */
export async function addRecentHfModel(context: vscode.ExtensionContext, model: string): Promise<void> {
	const recent = getRecentHfModels(context);
	// Remove if already exists (to move to top)
	const filtered = recent.filter(m => m !== model);
	// Add to beginning
	filtered.unshift(model);
	// Keep only MAX_RECENT_MODELS
	const updated = filtered.slice(0, MAX_RECENT_MODELS);
	await context.globalState.update(HF_RECENT_MODELS_KEY, updated);
}

/**
 * Show Hugging Face model selection submenu
 * Returns the selected model name or undefined if cancelled
 */
export async function showHfModelPicker(context: vscode.ExtensionContext, config: vscode.WorkspaceConfiguration): Promise<string | undefined> {
	const currentHfModel = config.get<string>('hfModel', 'Qwen/Qwen2.5-Coder-7B-Instruct');
	const popularModels = config.get<string[]>('hfPopularModels', [
		'Qwen/Qwen2.5-Coder-7B-Instruct',
		'Qwen/Qwen2.5-Coder-32B-Instruct',
		'mistralai/Mistral-7B-Instruct-v0.3',
		'codellama/CodeLlama-7b-Instruct-hf',
		'bigcode/starcoder2-15b',
		'meta-llama/Llama-3.1-8B-Instruct',
		'deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct'
	]);
	const recentModels = getRecentHfModels(context);

	interface HfModelQuickPickItem extends vscode.QuickPickItem {
		modelName?: string;
		isCustom?: boolean;
		isSeparator?: boolean;
	}

	const items: HfModelQuickPickItem[] = [];

	// Add recent models section if any
	if (recentModels.length > 0) {
		items.push({
			label: '$(history) Recently Used',
			kind: vscode.QuickPickItemKind.Separator
		});

		for (const model of recentModels) {
			const isCurrent = model === currentHfModel;
			items.push({
				label: `${isCurrent ? '$(check) ' : ''}${model}`,
				description: isCurrent ? '(current)' : undefined,
				modelName: model
			});
		}
	}

	// Add popular models section
	items.push({
		label: '$(star) Popular Models',
		kind: vscode.QuickPickItemKind.Separator
	});

	for (const model of popularModels) {
		// Skip if already in recent
		if (recentModels.includes(model)) {
			continue;
		}
		const isCurrent = model === currentHfModel && !recentModels.includes(model);
		items.push({
			label: `${isCurrent ? '$(check) ' : ''}${model}`,
			description: isCurrent ? '(current)' : undefined,
			modelName: model
		});
	}

	// Add custom input option
	items.push({
		label: '$(edit) Custom',
		kind: vscode.QuickPickItemKind.Separator
	});

	items.push({
		label: '$(pencil) Enter custom model name...',
		description: 'Type any Hugging Face model identifier',
		isCustom: true
	});

	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: `Current: ${currentHfModel} | Select Hugging Face model`,
		matchOnDescription: true
	});

	if (!selected) {
		return undefined;
	}

	if (selected.isCustom) {
		// Show input box for custom model
		const customModel = await vscode.window.showInputBox({
			prompt: 'Enter Hugging Face model name',
			placeHolder: 'e.g., organization/model-name',
			value: currentHfModel,
			validateInput: (value) => {
				if (!value || !value.trim()) {
					return 'Model name cannot be empty';
				}
				if (!value.includes('/')) {
					return 'Model name should be in format: organization/model-name';
				}
				return undefined;
			}
		});
		return customModel?.trim();
	}

	return selected.modelName;
}

/**
 * Show a configuration picker for OpenAI-compatible endpoint settings.
 * Prompts the user to configure endpoint and model, then saves to settings.
 */
export async function showOpenAICompatiblePicker(config: vscode.WorkspaceConfiguration): Promise<void> {
	const currentEndpoint = config.get<string>('openaiCompatible.endpoint', 'http://localhost:1234/v1');
	const currentModel = config.get<string>('openaiCompatible.model', '');

	// Offer quick-select for popular server presets
	const presets = [
		{ label: '$(server) LM Studio (local)', description: 'http://localhost:1234/v1', endpoint: 'http://localhost:1234/v1' },
		{ label: '$(server) LocalAI (local)', description: 'http://localhost:8080/v1', endpoint: 'http://localhost:8080/v1' },
		{ label: '$(server) vLLM (local)', description: 'http://localhost:8000/v1', endpoint: 'http://localhost:8000/v1' },
		{ label: '$(cloud) Groq', description: 'https://api.groq.com/openai/v1', endpoint: 'https://api.groq.com/openai/v1' },
		{ label: '$(cloud) OpenRouter', description: 'https://openrouter.ai/api/v1', endpoint: 'https://openrouter.ai/api/v1' },
		{ label: '$(cloud) Together AI', description: 'https://api.together.xyz/v1', endpoint: 'https://api.together.xyz/v1' },
		{ label: '$(pencil) Custom endpoint...', description: 'Enter a custom base URL', endpoint: '__custom__' }
	];

	const selectedPreset = await vscode.window.showQuickPick(presets, {
		placeHolder: `Current endpoint: ${currentEndpoint} | Select server or enter custom endpoint`,
		matchOnDescription: true
	});

	if (!selectedPreset) {
		return;
	}

	let endpoint = selectedPreset.endpoint;

	if (endpoint === '__custom__') {
		const customEndpoint = await vscode.window.showInputBox({
			prompt: 'Enter the base URL for your OpenAI-compatible server',
			placeHolder: 'e.g., http://localhost:1234/v1',
			value: currentEndpoint,
			validateInput: (value) => {
				if (!value || !value.trim()) {
					return 'Endpoint URL cannot be empty';
				}
				if (!value.startsWith('http://') && !value.startsWith('https://')) {
					return 'URL must start with http:// or https://';
				}
				return undefined;
			}
		});
		if (!customEndpoint) {
			return;
		}
		endpoint = customEndpoint.trim();
	}

	// Prompt for model name
	const modelName = await vscode.window.showInputBox({
		prompt: 'Enter the model name to use',
		placeHolder: 'e.g., lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF, llama3, gpt-4o',
		value: currentModel || '',
		validateInput: (value) => {
			if (!value || !value.trim()) {
				return 'Model name cannot be empty';
			}
			return undefined;
		}
	});

	if (!modelName) {
		return;
	}

	await config.update('openaiCompatible.endpoint', endpoint, vscode.ConfigurationTarget.Global);
	await config.update('openaiCompatible.model', modelName.trim(), vscode.ConfigurationTarget.Global);

	vscode.window.showInformationMessage(
		`OpenAI-compatible provider configured: ${modelName.trim()} @ ${endpoint}`
	);
}
