import * as vscode from 'vscode';
import axios from 'axios';
import { exec } from 'child_process';
import * as path from 'path';
import { OllamaReviewPanel } from './reviewProvider';
import { SkillsService } from './skillsService';
import { SkillsBrowserPanel } from './skillsBrowserPanel';
import { getOllamaModel } from './utils';
import { filterDiff, getFilterSummary } from './diffFilter';
import {
	ExplainCodeActionProvider,
	ExplainCodePanel,
	GenerateTestsActionProvider,
	GenerateTestsPanel,
	getTestFileName,
	detectTestFramework,
	FixIssueActionProvider,
	FixPreviewPanel,
	FixTracker,
	AddDocumentationActionProvider,
	DocumentationPreviewPanel,
	getDocumentationStyle,
	parseCodeResponse
} from './codeActions';

const CLAUDE_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const GLM_API_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';
const HF_API_ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';
const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MISTRAL_API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

/**
 * Performance metrics captured from API responses
 */
export interface PerformanceMetrics {
	// Ollama-specific metrics (from response body)
	totalDuration?: number;      // Total duration in nanoseconds
	loadDuration?: number;       // Model load duration in nanoseconds
	promptEvalCount?: number;    // Number of tokens in prompt
	evalCount?: number;          // Number of tokens generated
	evalDuration?: number;       // Generation duration in nanoseconds

	// Hugging Face-specific metrics (from response headers)
	hfRateLimitRemaining?: number;
	hfRateLimitReset?: number;   // Unix timestamp

	// Claude-specific metrics (from response body)
	claudeInputTokens?: number;
	claudeOutputTokens?: number;

	// Gemini-specific metrics (from response body)
	geminiInputTokens?: number;
	geminiOutputTokens?: number;

	// Mistral-specific metrics (from response body)
	mistralInputTokens?: number;
	mistralOutputTokens?: number;

	// Common computed metrics
	tokensPerSecond?: number;
	totalDurationSeconds?: number;
	model?: string;
	provider?: 'ollama' | 'claude' | 'glm' | 'huggingface' | 'gemini' | 'mistral';

	// Active model info (from /api/ps)
	activeModel?: {
		name: string;
		sizeVram?: number;   // VRAM usage in bytes
		sizeTotal?: number;  // Total size in bytes
		expiresAt?: string;
	};
}

// Global state for the last operation's metrics
let lastPerformanceMetrics: PerformanceMetrics | null = null;

/**
 * Get the last captured performance metrics
 */
export function getLastPerformanceMetrics(): PerformanceMetrics | null {
	return lastPerformanceMetrics;
}

/**
 * Clear the performance metrics
 */
export function clearPerformanceMetrics(): void {
	lastPerformanceMetrics = null;
}

/**
 * Check currently active models using Ollama's /api/ps endpoint
 * Returns information about models loaded in memory/VRAM
 */
export async function checkActiveModels(config: vscode.WorkspaceConfiguration): Promise<PerformanceMetrics['activeModel'] | undefined> {
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const baseUrl = endpoint.replace(/\/api\/generate\/?$/, '').replace(/\/$/, '');
	const psUrl = `${baseUrl}/api/ps`;

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3000);

		const response = await fetch(psUrl, { signal: controller.signal });
		clearTimeout(timeout);

		if (!response.ok) {
			return undefined;
		}

		const data = await response.json() as {
			models?: Array<{
				name: string;
				model: string;
				size: number;
				digest: string;
				details?: {
					parent_model?: string;
					format?: string;
					family?: string;
					families?: string[];
					parameter_size?: string;
					quantization_level?: string;
				};
				expires_at: string;
				size_vram: number;
			}>;
		};

		if (data.models && data.models.length > 0) {
			const activeModel = data.models[0];
			return {
				name: activeModel.name,
				sizeVram: activeModel.size_vram,
				sizeTotal: activeModel.size,
				expiresAt: activeModel.expires_at
			};
		}

		return undefined;
	} catch {
		// Ollama not running or /api/ps not available
		return undefined;
	}
}

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
 * Check if the model is a Hugging Face model
 */
function isHuggingFaceModel(model: string): boolean {
	return model === 'huggingface';
}

/**
 * Check if the model is a Gemini model
 */
function isGeminiModel(model: string): boolean {
	return model.startsWith('gemini-');
}

/**
 * Check if the model is a Mistral model
 */
function isMistralModel(model: string): boolean {
	return model.startsWith('mistral-') || model.startsWith('codestral-');
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
async function callClaudeAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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

	// Capture metrics from Claude's response
	if (captureMetrics && response.data.usage) {
		lastPerformanceMetrics = {
			provider: 'claude',
			model: model,
			claudeInputTokens: response.data.usage.input_tokens,
			claudeOutputTokens: response.data.usage.output_tokens,
			promptEvalCount: response.data.usage.input_tokens,
			evalCount: response.data.usage.output_tokens
		};
	}

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
async function callGlmAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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

	// Capture metrics from GLM's response
	if (captureMetrics && response.data.usage) {
		lastPerformanceMetrics = {
			provider: 'glm',
			model: glmModel,
			promptEvalCount: response.data.usage.prompt_tokens,
			evalCount: response.data.usage.completion_tokens
		};
	}

	// Extract text from GLM's OpenAI-compatible response format
	const choices = response.data.choices;
	if (Array.isArray(choices) && choices.length > 0 && choices[0].message) {
		return choices[0].message.content?.trim() || '';
	}

	return '';
}

/**
 * Call Hugging Face Inference API for generating responses
 * Uses the new router.huggingface.co OpenAI-compatible endpoint
 * Returns both the response content and performance metrics
 */
async function callHuggingFaceAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
	const apiKey = config.get<string>('hfApiKey', '');
	const hfModel = config.get<string>('hfModel', 'Qwen/Qwen2.5-Coder-7B-Instruct');
	const temperature = config.get<number>('temperature', 0);

	if (!apiKey) {
		throw new Error('Hugging Face API key is not configured. Please set it in Settings > Ollama Code Review > Hf Api Key');
	}

	if (!hfModel) {
		throw new Error('Hugging Face model is not configured. Please set it in Settings > Ollama Code Review > Hf Model');
	}

	try {
		const response = await axios.post(
			HF_API_ENDPOINT,
			{
				model: hfModel,
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
				max_tokens: 4096
			},
			{
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				timeout: 120000 // 2 minute timeout for model loading
			}
		);

		// Capture rate-limit metrics from headers if requested
		if (captureMetrics) {
			const rateLimitRemaining = response.headers['x-ratelimit-remaining'];
			const rateLimitReset = response.headers['x-ratelimit-reset'];
			const usage = response.data.usage;

			lastPerformanceMetrics = {
				provider: 'huggingface',
				model: hfModel,
				hfRateLimitRemaining: rateLimitRemaining ? parseInt(rateLimitRemaining, 10) : undefined,
				hfRateLimitReset: rateLimitReset ? parseInt(rateLimitReset, 10) : undefined,
				promptEvalCount: usage?.prompt_tokens,
				evalCount: usage?.completion_tokens
			};
		}

		// Extract text from OpenAI-compatible response format
		const choices = response.data.choices;
		if (Array.isArray(choices) && choices.length > 0 && choices[0].message) {
			return choices[0].message.content?.trim() || '';
		}

		return '';
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const status = error.response?.status;
			const errorData = error.response?.data;
			const headers = error.response?.headers;

			// Log full error details to output channel for debugging
			console.log('[HuggingFace API Error]', {
				status,
				statusText: error.response?.statusText,
				headers: headers,
				data: errorData,
				message: error.message
			});

			// Handle model loading (503) - wait and retry
			if (status === 503 && errorData?.estimated_time) {
				const waitTime = Math.min(errorData.estimated_time * 1000, 60000);
				vscode.window.showInformationMessage(`Model is loading, please wait ${Math.ceil(waitTime / 1000)}s...`);
				await new Promise(resolve => setTimeout(resolve, waitTime));
				return callHuggingFaceAPI(prompt, config, captureMetrics); // Retry
			}

			// Provide helpful error messages
			if (status === 404) {
				throw new Error(
					`Model "${hfModel}" not found on Hugging Face.\n` +
					`Make sure the model name is correct (case-sensitive).\n` +
					`Try: Qwen/Qwen2.5-Coder-7B-Instruct`
				);
			}

			if (status === 401 || status === 403) {
				// Log full response for auth errors
				console.log('[HuggingFace Auth Error] Full response:', JSON.stringify(errorData, null, 2));
				throw new Error(
					`Hugging Face authentication failed (${status}).\n` +
					`Response: ${JSON.stringify(errorData)}\n` +
					`Please check your API token in Settings > Ollama Code Review > Hf Api Key`
				);
			}

			// Re-throw with more context
			const errorMessage = errorData?.error?.message || errorData?.error || errorData?.message || error.message;
			throw new Error(`Hugging Face API Error (${status}): ${errorMessage}\nFull response: ${JSON.stringify(errorData)}`);
		}
		throw error;
	}
}

/**
 * Call Gemini API (Google AI Studio) for generating responses
 */
async function callGeminiAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
	const model = getOllamaModel(config);
	const apiKey = config.get<string>('geminiApiKey', '');
	const temperature = config.get<number>('temperature', 0);

	if (!apiKey) {
		throw new Error('Gemini API key is not configured. Please set it in Settings > Ollama Code Review > Gemini Api Key');
	}

	const endpoint = `${GEMINI_API_ENDPOINT}/${model}:generateContent?key=${apiKey}`;

	try {
		const response = await axios.post(
			endpoint,
			{
				contents: [
					{
						role: 'user',
						parts: [
							{
								text: prompt
							}
						]
					}
				],
				generationConfig: {
					temperature: temperature,
					topK: 40,
					topP: 0.95,
					maxOutputTokens: 8192,
					responseMimeType: 'text/plain'
				},
				systemInstruction: {
					parts: [
						{
							text: 'You are an expert software engineer and code reviewer.'
						}
					]
				}
			},
			{
				headers: {
					'Content-Type': 'application/json'
				},
				timeout: 120000 // 2 minute timeout
			}
		);

		// Capture metrics from Gemini's response
		if (captureMetrics && response.data.usageMetadata) {
			lastPerformanceMetrics = {
				provider: 'gemini',
				model: model,
				geminiInputTokens: response.data.usageMetadata.promptTokenCount,
				geminiOutputTokens: response.data.usageMetadata.candidatesTokenCount,
				promptEvalCount: response.data.usageMetadata.promptTokenCount,
				evalCount: response.data.usageMetadata.candidatesTokenCount
			};
		}

		// Extract text from Gemini's response format
		const candidates = response.data.candidates;
		if (Array.isArray(candidates) && candidates.length > 0 && candidates[0].content?.parts) {
			return candidates[0].content.parts
				.map((part: { text?: string }) => part.text || '')
				.join('')
				.trim();
		}

		return '';
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const status = error.response?.status;
			const errorData = error.response?.data;

			if (status === 400) {
				const errorMessage = errorData?.error?.message || 'Invalid request';
				throw new Error(`Gemini API Error: ${errorMessage}`);
			}

			if (status === 401 || status === 403) {
				throw new Error(
					`Gemini authentication failed.\n` +
					`Please check your API key in Settings > Ollama Code Review > Gemini Api Key`
				);
			}

			if (status === 429) {
				throw new Error(
					`Gemini rate limit exceeded.\n` +
					`Free tier allows 15 RPM for Flash, 5 RPM for Pro. Please wait and try again.`
				);
			}

			if (status === 503) {
				throw new Error(
					`Gemini service temporarily unavailable. Please try again in a moment.`
				);
			}

			const errorMessage = errorData?.error?.message || error.message;
			throw new Error(`Gemini API Error (${status}): ${errorMessage}`);
		}
		throw error;
	}
}

/**
 * Call Mistral API for generating responses
 */
async function callMistralAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
	const model = getOllamaModel(config);
	const apiKey = config.get<string>('mistralApiKey', '');
	const temperature = config.get<number>('temperature', 0);

	if (!apiKey) {
		throw new Error('Mistral API key is not configured. Please set it in Settings > Ollama Code Review > Mistral Api Key');
	}

	try {
		const response = await axios.post(
			MISTRAL_API_ENDPOINT,
			{
				model: model,
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
					'Content-Type': 'application/json'
				},
				timeout: 120000 // 2 minute timeout
			}
		);

		// Capture metrics from Mistral's response
		if (captureMetrics && response.data.usage) {
			lastPerformanceMetrics = {
				provider: 'mistral',
				model: model,
				mistralInputTokens: response.data.usage.prompt_tokens,
				mistralOutputTokens: response.data.usage.completion_tokens,
				promptEvalCount: response.data.usage.prompt_tokens,
				evalCount: response.data.usage.completion_tokens
			};
		}

		// Extract text from Mistral's OpenAI-compatible response format
		const choices = response.data.choices;
		if (Array.isArray(choices) && choices.length > 0 && choices[0].message) {
			return choices[0].message.content?.trim() || '';
		}

		return '';
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const status = error.response?.status;
			const errorData = error.response?.data;

			if (status === 401) {
				throw new Error(
					`Mistral authentication failed.\n` +
					`Please check your API key in Settings > Ollama Code Review > Mistral Api Key`
				);
			}

			if (status === 429) {
				throw new Error(
					`Mistral rate limit exceeded. Please wait and try again.`
				);
			}

			if (status === 503) {
				throw new Error(
					`Mistral service temporarily unavailable. Please try again in a moment.`
				);
			}

			const errorMessage = errorData?.error?.message || errorData?.message || error.message;
			throw new Error(`Mistral API Error (${status}): ${errorMessage}`);
		}
		throw error;
	}
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
async function addRecentHfModel(context: vscode.ExtensionContext, model: string): Promise<void> {
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
async function showHfModelPicker(context: vscode.ExtensionContext, config: vscode.WorkspaceConfiguration): Promise<string | undefined> {
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
			{ label: 'huggingface', description: 'Hugging Face Inference API (select model →)' },
			{ label: 'gemini-2.5-flash', description: 'Gemini 2.5 Flash - Free tier (Google AI)' },
			{ label: 'gemini-2.5-pro', description: 'Gemini 2.5 Pro - Free tier (Google AI)' },
			{ label: 'mistral-large-latest', description: 'Mistral Large - Most capable (Mistral AI)' },
			{ label: 'mistral-small-latest', description: 'Mistral Small - Fast & efficient (Mistral AI)' },
			{ label: 'codestral-latest', description: 'Codestral - Optimized for code (Mistral AI)' },
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
				// If Hugging Face is selected, show the HF model picker
				if (selected.label === 'huggingface') {
					const hfModel = await showHfModelPicker(context, config);
					if (hfModel) {
						await config.update('model', 'huggingface', vscode.ConfigurationTarget.Global);
						await config.update('hfModel', hfModel, vscode.ConfigurationTarget.Global);
						await addRecentHfModel(context, hfModel);
						updateModelStatusBar(modelStatusBarItem);
						vscode.window.showInformationMessage(`Hugging Face model changed to: ${hfModel}`);
					}
					return;
				}

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
				// If Hugging Face is selected, show the HF model picker
				if (selected.label === 'huggingface') {
					const hfModel = await showHfModelPicker(context, config);
					if (hfModel) {
						await config.update('model', 'huggingface', vscode.ConfigurationTarget.Global);
						await config.update('hfModel', hfModel, vscode.ConfigurationTarget.Global);
						await addRecentHfModel(context, hfModel);
						updateModelStatusBar(modelStatusBarItem);
						vscode.window.showInformationMessage(`Hugging Face model changed to: ${hfModel}`);
					}
					return;
				}

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

	// Register new code action providers (F-005: Inline Code Actions)
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('*', new ExplainCodeActionProvider(), {
			providedCodeActionKinds: ExplainCodeActionProvider.providedCodeActionKinds
		}),
		vscode.languages.registerCodeActionsProvider('*', new GenerateTestsActionProvider(), {
			providedCodeActionKinds: GenerateTestsActionProvider.providedCodeActionKinds
		}),
		vscode.languages.registerCodeActionsProvider('*', new FixIssueActionProvider(), {
			providedCodeActionKinds: FixIssueActionProvider.providedCodeActionKinds
		}),
		vscode.languages.registerCodeActionsProvider('*', new AddDocumentationActionProvider(), {
			providedCodeActionKinds: AddDocumentationActionProvider.providedCodeActionKinds
		})
	);

	// Explain Code command (F-005)
	const explainCodeCommand = vscode.commands.registerCommand('ollama-code-review.explainCode', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select code to explain.');
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Explaining code...',
				cancellable: true
			}, async (progress, token) => {
				const explanation = await getExplanation(selectedText, editor.document.languageId);
				if (token.isCancellationRequested) { return; }

				ExplainCodePanel.createOrShow(selectedText, explanation, editor.document.languageId);
			});
		} catch (error) {
			handleError(error, 'Failed to explain code.');
		}
	});

	// Generate Tests command (F-005)
	const generateTestsCommand = vscode.commands.registerCommand('ollama-code-review.generateTests', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select a function or code to generate tests for.');
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Generating tests...',
				cancellable: true
			}, async (progress, token) => {
				const testFramework = await detectTestFramework();
				const result = await generateTests(selectedText, editor.document.languageId, testFramework);
				if (token.isCancellationRequested) { return; }

				const testFileName = getTestFileName(path.basename(editor.document.fileName));
				GenerateTestsPanel.createOrShow(
					result.code,
					testFileName,
					result.explanation,
					editor.document.fileName,
					editor.document.languageId
				);
			});
		} catch (error) {
			handleError(error, 'Failed to generate tests.');
		}
	});

	// Fix Issue command (F-005) - for diagnostics
	const fixIssueCommand = vscode.commands.registerCommand('ollama-code-review.fixIssue', async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic) => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document !== document) {
			vscode.window.showInformationMessage('Please ensure the file is open in the active editor.');
			return;
		}

		// Expand range to include full lines for context
		const startLine = diagnostic.range.start.line;
		const endLine = diagnostic.range.end.line;
		const expandedRange = new vscode.Range(
			new vscode.Position(Math.max(0, startLine - 2), 0),
			new vscode.Position(Math.min(document.lineCount - 1, endLine + 2), document.lineAt(Math.min(document.lineCount - 1, endLine + 2)).text.length)
		);
		const codeWithContext = document.getText(expandedRange);

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Generating fix...',
				cancellable: true
			}, async (progress, token) => {
				const result = await generateFix(codeWithContext, diagnostic.message, document.languageId);
				if (token.isCancellationRequested) { return; }

				FixPreviewPanel.createOrShow(
					editor,
					expandedRange,
					codeWithContext,
					result.code,
					result.explanation,
					diagnostic.message,
					document.languageId
				);
			});
		} catch (error) {
			handleError(error, 'Failed to generate fix.');
		}
	});

	// Fix Selection command (F-005) - for selected code
	const fixSelectionCommand = vscode.commands.registerCommand('ollama-code-review.fixSelection', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select code to fix.');
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Analyzing and fixing code...',
				cancellable: true
			}, async (progress, token) => {
				const result = await generateFix(selectedText, 'General code improvement', editor.document.languageId);
				if (token.isCancellationRequested) { return; }

				FixPreviewPanel.createOrShow(
					editor,
					selection,
					selectedText,
					result.code,
					result.explanation,
					'General code improvement',
					editor.document.languageId
				);
			});
		} catch (error) {
			handleError(error, 'Failed to fix code.');
		}
	});

	// Add Documentation command (F-005)
	const addDocumentationCommand = vscode.commands.registerCommand('ollama-code-review.addDocumentation', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select a function or class to document.');
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Generating documentation...',
				cancellable: true
			}, async (progress, token) => {
				const docStyle = getDocumentationStyle(editor.document.languageId);
				const result = await generateDocumentation(selectedText, editor.document.languageId, docStyle);
				if (token.isCancellationRequested) { return; }

				DocumentationPreviewPanel.createOrShow(
					editor,
					selection,
					result.code,
					selectedText,
					result.explanation,
					editor.document.languageId
				);
			});
		} catch (error) {
			handleError(error, 'Failed to generate documentation.');
		}
	});

	context.subscriptions.push(
		explainCodeCommand,
		generateTestsCommand,
		fixIssueCommand,
		fixSelectionCommand,
		addDocumentationCommand
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

		// Get performance metrics and check for active model
		const metrics = getLastPerformanceMetrics();
		const config = vscode.workspace.getConfiguration('ollama-code-review');

		// Check active models for Ollama provider
		if (metrics && metrics.provider === 'ollama') {
			const activeModel = await checkActiveModels(config);
			if (activeModel) {
				metrics.activeModel = activeModel;
			}
		}

		progress.report({ message: "Displaying review..." });
		OllamaReviewPanel.createOrShow(review, filteredDiff, context, metrics);
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
		// Clear previous metrics
		clearPerformanceMetrics();

		// Use Claude API if a Claude model is selected
		if (isClaudeModel(model)) {
			return await callClaudeAPI(prompt, config, true);
		}

		// Use GLM API if a GLM model is selected
		if (isGlmModel(model)) {
			return await callGlmAPI(prompt, config, true);
		}

		// Use Hugging Face API if huggingface is selected
		if (isHuggingFaceModel(model)) {
			return await callHuggingFaceAPI(prompt, config, true);
		}

		// Use Gemini API if a Gemini model is selected
		if (isGeminiModel(model)) {
			return await callGeminiAPI(prompt, config, true);
		}

		// Use Mistral API if a Mistral model is selected
		if (isMistralModel(model)) {
			return await callMistralAPI(prompt, config, true);
		}

		// Otherwise use Ollama API
		const response = await axios.post(endpoint, {
			model: model,
			prompt: prompt,
			stream: false,
			options: { temperature }
		});

		// Capture Ollama performance metrics from response
		const data = response.data;
		if (data) {
			const evalDuration = data.eval_duration || 0;
			const evalCount = data.eval_count || 0;
			const tokensPerSecond = evalDuration > 0 ? (evalCount / (evalDuration / 1e9)) : undefined;
			const totalDurationSeconds = data.total_duration ? data.total_duration / 1e9 : undefined;

			lastPerformanceMetrics = {
				provider: 'ollama',
				model: model,
				totalDuration: data.total_duration,
				loadDuration: data.load_duration,
				promptEvalCount: data.prompt_eval_count,
				evalCount: data.eval_count,
				evalDuration: data.eval_duration,
				tokensPerSecond: tokensPerSecond,
				totalDurationSeconds: totalDurationSeconds
			};
		}

		return data.response.trim();
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
		} else if (isHuggingFaceModel(model)) {
			// Use Hugging Face API if huggingface is selected
			message = await callHuggingFaceAPI(prompt, config);
		} else if (isGeminiModel(model)) {
			// Use Gemini API if a Gemini model is selected
			message = await callGeminiAPI(prompt, config);
		} else if (isMistralModel(model)) {
			// Use Mistral API if a Mistral model is selected
			message = await callMistralAPI(prompt, config);
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

		// Use Hugging Face API if huggingface is selected
		if (isHuggingFaceModel(model)) {
			return await callHuggingFaceAPI(prompt, config);
		}

		// Use Gemini API if a Gemini model is selected
		if (isGeminiModel(model)) {
			return await callGeminiAPI(prompt, config);
		}

		// Use Mistral API if a Mistral model is selected
		if (isMistralModel(model)) {
			return await callMistralAPI(prompt, config);
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

/**
 * Get detailed explanation for a code snippet (F-005)
 */
async function getExplanation(codeSnippet: string, languageId: string): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.2);

	const prompt = `
You are an expert software engineer and educator. Your task is to explain the following ${languageId} code in detail.

**Instructions:**
1. Start with a brief summary of what the code does (1-2 sentences).
2. Explain the code step by step, breaking down each important part.
3. Highlight any patterns, algorithms, or design decisions used.
4. Note any potential issues, edge cases, or areas for improvement.
5. If relevant, explain how this code might interact with other parts of a system.

**Code to explain:**
\`\`\`${languageId}
${codeSnippet}
\`\`\`

Provide your explanation in clear Markdown format.
`;

	return callAIProvider(prompt, config, model, endpoint, temperature);
}

/**
 * Generate unit tests for code (F-005)
 */
async function generateTests(codeSnippet: string, languageId: string, testFramework: string): Promise<{ code: string; explanation: string }> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.3);

	const prompt = `
You are an expert software engineer specializing in testing. Generate comprehensive unit tests for the following ${languageId} code using ${testFramework}.

**Instructions:**
1. Create test cases that cover the main functionality.
2. Include edge cases and error scenarios.
3. Use descriptive test names that explain what is being tested.
4. Follow ${testFramework} best practices and conventions.
5. Include necessary imports and setup.

**IMPORTANT:** Your response MUST follow this structure exactly:
1. Start with the test code inside a markdown code block (e.g., \`\`\`${languageId}\n...\n\`\`\`).
2. After the code block, provide a bulleted list explaining what each test covers.

**Code to test:**
\`\`\`${languageId}
${codeSnippet}
\`\`\`

Generate the tests now.
`;

	const response = await callAIProvider(prompt, config, model, endpoint, temperature);
	const parsed = parseCodeResponse(response);

	if (parsed) {
		return parsed;
	}

	return { code: response, explanation: 'Tests generated successfully.' };
}

/**
 * Generate a fix for an issue (F-005)
 */
async function generateFix(codeSnippet: string, issue: string, languageId: string): Promise<{ code: string; explanation: string }> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.2);

	const prompt = `
You are an expert software engineer. Fix the following issue in the ${languageId} code.

**Issue to fix:** ${issue}

**IMPORTANT:** Your response MUST follow this structure exactly:
1. Start with the fixed code inside a markdown code block (e.g., \`\`\`${languageId}\n...\n\`\`\`).
2. After the code block, explain what was wrong and how you fixed it.

**Code with issue:**
\`\`\`${languageId}
${codeSnippet}
\`\`\`

Provide the fixed code now.
`;

	const response = await callAIProvider(prompt, config, model, endpoint, temperature);
	const parsed = parseCodeResponse(response);

	if (parsed) {
		return parsed;
	}

	return { code: response, explanation: 'Fix applied.' };
}

/**
 * Generate documentation for code (F-005)
 */
async function generateDocumentation(codeSnippet: string, languageId: string, docStyle: string): Promise<{ code: string; explanation: string }> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.2);

	const styleGuide = {
		jsdoc: 'JSDoc format with @param, @returns, @throws, @example tags',
		tsdoc: 'TSDoc format with @param, @returns, @throws, @example, and TypeScript-specific tags',
		pydoc: 'Python docstring format with Args, Returns, Raises, Examples sections',
		generic: 'Standard documentation comment format for the language'
	};

	const prompt = `
You are an expert technical writer. Generate documentation for the following ${languageId} code.

**Documentation style:** ${styleGuide[docStyle as keyof typeof styleGuide]}

**Instructions:**
1. Document the purpose of the function/class.
2. Document all parameters with their types and descriptions.
3. Document the return value if applicable.
4. Document any exceptions/errors that may be thrown.
5. Include a brief example if helpful.

**IMPORTANT:** Your response MUST follow this structure exactly:
1. Start with ONLY the documentation comment (no code) inside a markdown code block.
2. After the code block, briefly explain what you documented.

**Code to document:**
\`\`\`${languageId}
${codeSnippet}
\`\`\`

Generate the documentation comment now.
`;

	const response = await callAIProvider(prompt, config, model, endpoint, temperature);
	const parsed = parseCodeResponse(response);

	if (parsed) {
		return parsed;
	}

	return { code: response, explanation: 'Documentation generated.' };
}

/**
 * Helper function to call the appropriate AI provider
 */
async function callAIProvider(prompt: string, config: vscode.WorkspaceConfiguration, model: string, endpoint: string, temperature: number): Promise<string> {
	if (isClaudeModel(model)) {
		return await callClaudeAPI(prompt, config);
	}

	if (isGlmModel(model)) {
		return await callGlmAPI(prompt, config);
	}

	if (isHuggingFaceModel(model)) {
		return await callHuggingFaceAPI(prompt, config);
	}

	if (isGeminiModel(model)) {
		return await callGeminiAPI(prompt, config);
	}

	if (isMistralModel(model)) {
		return await callMistralAPI(prompt, config);
	}

	// Default to Ollama API
	const response = await axios.post(endpoint, {
		model: model,
		prompt: prompt,
		stream: false,
		options: { temperature }
	});
	return response.data.response.trim();
}

function handleError(error: unknown, contextMessage: string) {
	let errorMessage = `${contextMessage}\n`;
	if (error && typeof error === 'object' && 'stderr' in error && (error as any).stderr) {
		errorMessage += `Git Error: ${(error as any).stderr}`;
	} else if (axios.isAxiosError(error)) {
		const url = error.config?.url || '';
		const status = error.response?.status;
		const responseData = error.response?.data;

		// Determine which API caused the error based on URL
		if (url.includes('anthropic.com')) {
			errorMessage += `Claude API Error (${status}): ${responseData?.error?.message || error.message}`;
		} else if (url.includes('z.ai') || url.includes('bigmodel.cn')) {
			errorMessage += `GLM API Error (${status}): ${responseData?.error?.message || error.message}`;
		} else if (url.includes('huggingface.co') || url.includes('router.huggingface.co')) {
			const hfError = responseData?.error || responseData?.message || error.message;
			errorMessage += `Hugging Face API Error (${status}): ${hfError}`;
			if (status === 410) {
				errorMessage += '\nThe model may not be available. Try a different model like "Qwen/Qwen2.5-Coder-7B-Instruct" or "mistralai/Mistral-7B-Instruct-v0.3"';
			} else if (status === 503) {
				errorMessage += '\nThe model is loading. Please try again in a few seconds.';
			}
		} else if (url.includes('generativelanguage.googleapis.com')) {
			const geminiError = responseData?.error?.message || error.message;
			errorMessage += `Gemini API Error (${status}): ${geminiError}`;
			if (status === 429) {
				errorMessage += '\nRate limit exceeded. Free tier allows 15 RPM for Flash, 5 RPM for Pro.';
			} else if (status === 503) {
				errorMessage += '\nThe model is loading. Please try again in a few seconds.';
			}
		} else if (url.includes('api.mistral.ai')) {
			const mistralError = responseData?.error?.message || responseData?.message || error.message;
			errorMessage += `Mistral API Error (${status}): ${mistralError}`;
			if (status === 429) {
				errorMessage += '\nRate limit exceeded. Please wait and try again.';
			}
		} else {
			errorMessage += `Ollama API Error: ${error.message}. Is Ollama running? Check the endpoint in settings.`;
		}
	} else if (error instanceof Error) {
		errorMessage += `${error.message}`;
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
	// Dispose webview panels
	if (OllamaReviewPanel.currentPanel) {
		OllamaReviewPanel.currentPanel.dispose();
	}
	if (SkillsBrowserPanel.currentPanel) {
		SkillsBrowserPanel.currentPanel.dispose();
	}
	if (ExplainCodePanel.currentPanel) {
		ExplainCodePanel.currentPanel.dispose();
	}
	if (GenerateTestsPanel.currentPanel) {
		GenerateTestsPanel.currentPanel.dispose();
	}
	if (FixPreviewPanel.currentPanel) {
		FixPreviewPanel.currentPanel.dispose();
	}
	if (DocumentationPreviewPanel.currentPanel) {
		DocumentationPreviewPanel.currentPanel.dispose();
	}

	// Dispose output channel
	if (outputChannel) {
		outputChannel.dispose();
	}
}
