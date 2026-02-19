import * as vscode from 'vscode';
import axios from 'axios';
import { exec } from 'child_process';
import * as path from 'path';
import { OllamaReviewPanel } from './reviewProvider';
import { SkillsService } from './skillsService';
import { SkillsBrowserPanel } from './skillsBrowserPanel';
import { getOllamaModel, resolvePrompt } from './utils';
import { filterDiff, getFilterSummary, getDiffFilterConfigWithYaml } from './diffFilter';
import {
	getEffectiveReviewPrompt,
	getEffectiveCommitPrompt,
	getEffectiveFrameworks,
	clearProjectConfigCache
} from './config/promptLoader';
import {
	ReviewProfile,
	BUILTIN_PROFILES,
	COMPLIANCE_PROFILES,
	getAllProfiles,
	getActiveProfileName,
	setActiveProfileName,
	getActiveProfile,
	saveCustomProfile,
	deleteCustomProfile,
	buildProfilePromptContext
} from './profiles';
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
import {
	promptAndFetchPR,
	parsePRInput,
	parseRemoteUrl,
	postPRSummaryComment,
	postPRReview,
	PRReference
} from './github/prReview';
import { getGitHubAuth, showAuthSetupGuide } from './github/auth';
import { parseReviewIntoFindings } from './github/commentMapper';
import {
	getPreCommitGuardConfig,
	isHookInstalled,
	installHook,
	uninstallHook,
	createBypassFile,
	removeBypassFile,
	assessSeverity,
	formatAssessmentSummary
} from './preCommitGuard';
import {
	gatherContext,
	formatContextForPrompt,
	getContextGatheringConfig,
	ContextBundle,
} from './context';
import { sendNotifications, type NotificationPayload } from './notifications';
import {
	parseFindingCounts,
	computeScore,
	ReviewScoreStore,
	ReviewHistoryPanel,
	updateScoreStatusBar,
	type ReviewScore,
} from './reviewScore';

const CLAUDE_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const GLM_API_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';
const HF_API_ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';
const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MISTRAL_API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MINIMAX_API_ENDPOINT = 'https://api.minimax.io/v1/text/chatcompletion_v2';

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

	// MiniMax-specific metrics (from response body)
	minimaxInputTokens?: number;
	minimaxOutputTokens?: number;

	// OpenAI-compatible provider metrics (from response body)
	openaiCompatibleInputTokens?: number;
	openaiCompatibleOutputTokens?: number;

	// Common computed metrics
	tokensPerSecond?: number;
	totalDurationSeconds?: number;
	model?: string;
	provider?: 'ollama' | 'claude' | 'glm' | 'huggingface' | 'gemini' | 'mistral' | 'minimax' | 'openai-compatible';

	// Active model info (from /api/ps)
	activeModel?: {
		name: string;
		sizeVram?: number;   // VRAM usage in bytes
		sizeTotal?: number;  // Total size in bytes
		expiresAt?: string;
	};

	// Active review profile
	activeProfile?: string;
}

// Global state for the last operation's metrics
let lastPerformanceMetrics: PerformanceMetrics | null = null;

// Global reference to the skills service for cleanup on deactivation
let skillsServiceInstance: SkillsService | null = null;

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

// Default prompt templates (used when settings are empty)
const DEFAULT_REVIEW_PROMPT = "You are an expert software engineer and code reviewer with deep knowledge of the following frameworks and libraries: **${frameworks}**.\nYour task is to analyze the following code changes (in git diff format) and provide constructive, actionable feedback tailored to the conventions, best practices, and common pitfalls of these technologies.\n${skills}\n${profile}\n**How to Read the Git Diff Format:**\n- Lines starting with `---` and `+++` indicate the file names before and after the changes.\n- Lines starting with `@@` (e.g., `@@ -15,7 +15,9 @@`) denote the location of the changes within the file.\n- Lines starting with a `-` are lines that were DELETED.\n- Lines starting with a `+` are lines that were ADDED.\n- Lines without a prefix (starting with a space) are for context and have not been changed. **Please focus your review on the added (`+`) and deleted (`-`) lines.**\n\n**Review Focus:**\n- Potential bugs or logical errors specific to the frameworks/libraries (${frameworks}).\n- Performance optimizations, considering framework-specific patterns.\n- Code style inconsistencies or deviations from ${frameworks} best practices.\n- Security vulnerabilities, especially those common in ${frameworks}.\n- Improvements to maintainability and readability, aligned with ${frameworks} conventions.\n\n**Feedback Requirements:**\n1. Explain any issues clearly and concisely, referencing ${frameworks} where relevant.\n2. Suggest specific code changes or improvements. Include code snippets for examples where appropriate.\n3. Use Markdown for clear formatting.\n\nIf you find no issues, please respond with the single sentence: \"I have reviewed the changes and found no significant issues.\"\n\nHere is the code diff to review:\n---\n${code}\n---";

const DEFAULT_COMMIT_MESSAGE_PROMPT = "You are an expert at writing git commit messages for Semantic Release.\nGenerate a commit message based on the git diff below following the Conventional Commits specification.\n\n### Structural Requirements:\n1. **Subject Line**: <type>(<scope>): <short description>\n   - Keep under 50 characters.\n   - Use imperative mood (\"add\" not \"added\").\n   - Types: feat (new feature), fix (bug fix), docs, style, refactor, perf, test, build, ci, chore, revert.\n2. **Body**: Explain 'what' and 'why'. Required if the change is complex.\n3. **Breaking Changes**: If the diff contains breaking changes, the footer MUST start with \"BREAKING CHANGE:\" followed by a description.\n\n### Rules:\n- If the user's draft mentions a breaking change, prioritize documenting it in the footer.\n- Semantic Release triggers: 'feat' for MINOR, 'fix' for PATCH, and 'BREAKING CHANGE' in footer for MAJOR.\n- Output ONLY the raw commit message text. No markdown blocks, no \"Here is your message,\" no preamble.\n\nDeveloper's draft message (may reflect intent):\n${draftMessage}\n\nStaged git diff:\n---\n${diff}\n---";

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
 * Check if the model is a MiniMax model
 */
function isMiniMaxModel(model: string): boolean {
	return model.toLocaleLowerCase().startsWith('minimax-');
}

/**
 * Check if the model is an OpenAI-compatible model (LM Studio, vLLM, LocalAI, Groq, OpenRouter, etc.)
 */
function isOpenAICompatibleModel(model: string): boolean {
	return model === 'openai-compatible';
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

/**
 * Call MiniMax API for generating responses
 */
async function callMiniMaxAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
	const model = getOllamaModel(config);
	const apiKey = config.get<string>('minimaxApiKey', '');
	const temperature = config.get<number>('temperature', 0);

	if (!apiKey) {
		throw new Error('MiniMax API key is not configured. Please set it in Settings > Ollama Code Review > Minimax Api Key');
	}

	// Use the model name as-is for the MiniMax API (e.g., "MiniMax-M2.5")
	const minimaxModel = model;

	try {
		const response = await axios.post(
			MINIMAX_API_ENDPOINT,
			{
				model: minimaxModel,
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

		// Capture metrics from MiniMax's response
		if (captureMetrics && response.data.usage) {
			lastPerformanceMetrics = {
				provider: 'minimax',
				model: model,
				minimaxInputTokens: response.data.usage.prompt_tokens,
				minimaxOutputTokens: response.data.usage.completion_tokens,
				promptEvalCount: response.data.usage.prompt_tokens,
				evalCount: response.data.usage.completion_tokens
			};
		}

		// Extract text from MiniMax's OpenAI-compatible response format
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
					`MiniMax authentication failed.\n` +
					`Please check your API key in Settings > Ollama Code Review > Minimax Api Key`
				);
			}

			if (status === 429) {
				throw new Error(
					`MiniMax rate limit exceeded. Please wait and try again.`
				);
			}

			if (status === 503) {
				throw new Error(
					`MiniMax service temporarily unavailable. Please try again in a moment.`
				);
			}

			const errorMessage = errorData?.error?.message || errorData?.message || error.message;
			throw new Error(`MiniMax API Error (${status}): ${errorMessage}`);
		}
		throw error;
	}
}


/**
 * Call any OpenAI-compatible API endpoint (LM Studio, vLLM, LocalAI, Groq, OpenRouter, etc.)
 */
async function callOpenAICompatibleAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
	const endpoint = config.get<string>('openaiCompatible.endpoint', 'http://localhost:1234/v1');
	const apiKey = config.get<string>('openaiCompatible.apiKey', '');
	const model = config.get<string>('openaiCompatible.model', '');
	const temperature = config.get<number>('temperature', 0);

	if (!model) {
		throw new Error(
			'OpenAI-compatible model is not configured.\n' +
			'Please set it in Settings > Ollama Code Review > OpenAI Compatible > Model\n' +
			'Example: lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF'
		);
	}

	const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};

	if (apiKey) {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	try {
		const response = await axios.post(
			url,
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
				headers,
				timeout: 120000 // 2 minute timeout
			}
		);

		// Capture metrics from OpenAI-compatible response (standard usage field)
		if (captureMetrics && response.data.usage) {
			lastPerformanceMetrics = {
				provider: 'openai-compatible',
				model: model,
				openaiCompatibleInputTokens: response.data.usage.prompt_tokens,
				openaiCompatibleOutputTokens: response.data.usage.completion_tokens,
				promptEvalCount: response.data.usage.prompt_tokens,
				evalCount: response.data.usage.completion_tokens
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

			if (status === 401) {
				throw new Error(
					`OpenAI-compatible API authentication failed.\n` +
					`Please check your API key in Settings > Ollama Code Review > OpenAI Compatible > Api Key`
				);
			}

			if (status === 404) {
				throw new Error(
					`Model "${model}" not found on the OpenAI-compatible endpoint.\n` +
					`Check the model name in Settings > Ollama Code Review > OpenAI Compatible > Model`
				);
			}

			if (status === 429) {
				throw new Error(`OpenAI-compatible API rate limit exceeded. Please wait and try again.`);
			}

			if (!status || status === 503 || error.code === 'ECONNREFUSED') {
				throw new Error(
					`Could not connect to OpenAI-compatible endpoint at ${endpoint}.\n` +
					`Make sure your server (LM Studio, vLLM, LocalAI, etc.) is running.\n` +
					`Check the endpoint in Settings > Ollama Code Review > OpenAI Compatible > Endpoint`
				);
			}

			const errorMessage = errorData?.error?.message || errorData?.message || error.message;
			throw new Error(`OpenAI-compatible API Error (${status}): ${errorMessage}`);
		}
		throw error;
	}
}


let outputChannel: vscode.OutputChannel;

// F-016: Score status bar item (initialised in activate())
let scoreStatusBarItem: vscode.StatusBarItem | undefined;
// Extension context reference for score store (set in activate())
let extensionGlobalStoragePath: string | undefined;

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

function updateProfileStatusBar(statusBarItem: vscode.StatusBarItem, context: vscode.ExtensionContext) {
	const profile = getActiveProfile(context);
	statusBarItem.text = `$(shield) ${profile.name}`;
	statusBarItem.tooltip = `Review Profile: ${profile.name}\n${profile.description}\nClick to switch profile`;
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

/**
 * Show a configuration picker for OpenAI-compatible endpoint settings.
 * Prompts the user to configure endpoint and model, then saves to settings.
 */
async function showOpenAICompatiblePicker(config: vscode.WorkspaceConfiguration): Promise<void> {
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

export async function activate(context: vscode.ExtensionContext) {
	const skillsService = await SkillsService.create(context);
	// Store reference for cleanup on deactivation
	skillsServiceInstance = skillsService;
	outputChannel = vscode.window.createOutputChannel("Ollama Code Review");
	const suggestionProvider = new SuggestionContentProvider();

	// Create status bar item for model selection (appears in bottom status bar)
	const modelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	modelStatusBarItem.command = 'ollama-code-review.selectModel';
	updateModelStatusBar(modelStatusBarItem);
	modelStatusBarItem.show();
	context.subscriptions.push(modelStatusBarItem);

	// Create status bar item for profile selection (next to model selector)
	const profileStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	profileStatusBarItem.command = 'ollama-code-review.selectProfile';
	updateProfileStatusBar(profileStatusBarItem, context);
	profileStatusBarItem.show();
	context.subscriptions.push(profileStatusBarItem);

	// Register profile selection command
	const selectProfileCommand = vscode.commands.registerCommand('ollama-code-review.selectProfile', async () => {
		const profiles = getAllProfiles(context);
		const currentName = getActiveProfileName(context);

		const makeItem = (p: ReviewProfile) => ({
			label: p.name === currentName ? `$(check) ${p.name}` : p.name,
			description: p.description,
			detail: `${p.severity} severity | ${p.focusAreas.length} focus areas${p.includeExplanations ? ' | detailed explanations' : ''}`,
			profileName: p.name,
			kind: vscode.QuickPickItemKind.Default
		});

		// Partition profiles into built-in, compliance, and custom groups
		const builtinNames = new Set(BUILTIN_PROFILES.map(p => p.name));
		const complianceNames = new Set(COMPLIANCE_PROFILES.map(p => p.name));
		const builtinItems = profiles.filter(p => builtinNames.has(p.name)).map(makeItem);
		const complianceItems = profiles.filter(p => complianceNames.has(p.name)).map(makeItem);
		const customItems = profiles.filter(p => !builtinNames.has(p.name) && !complianceNames.has(p.name)).map(makeItem);

		const items: Array<{ label: string; description?: string; detail?: string; profileName: string; kind?: vscode.QuickPickItemKind }> = [
			...builtinItems,
			{ label: 'Compliance', profileName: '', kind: vscode.QuickPickItemKind.Separator },
			...complianceItems,
		];

		if (customItems.length > 0) {
			items.push({ label: 'Custom', profileName: '', kind: vscode.QuickPickItemKind.Separator });
			items.push(...customItems);
		}

		// Add management options at the bottom
		items.push(
			{ label: '', description: '', detail: '', profileName: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(add) Create Custom Profile...', description: 'Define a new review profile', detail: '', profileName: '__create__' },
			{ label: '$(trash) Delete Custom Profile...', description: 'Remove a user-defined profile', detail: '', profileName: '__delete__' }
		);

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: `Current: ${currentName} | Select a review profile`,
			matchOnDescription: true,
			matchOnDetail: true
		});

		if (!selected || !selected.profileName) {
			return;
		}

		if (selected.profileName === '__create__') {
			const name = await vscode.window.showInputBox({
				prompt: 'Profile name (lowercase, no spaces)',
				placeHolder: 'e.g., api-review',
				validateInput: (v) => {
					if (!v || !v.trim()) { return 'Name is required'; }
					if (/\s/.test(v)) { return 'No spaces allowed'; }
					if (v !== v.toLowerCase()) { return 'Must be lowercase'; }
					return undefined;
				}
			});
			if (!name) { return; }

			const description = await vscode.window.showInputBox({
				prompt: 'Short description',
				placeHolder: 'e.g., Focus on REST API design and error handling'
			});
			if (description === undefined) { return; }

			const focusInput = await vscode.window.showInputBox({
				prompt: 'Focus areas (comma-separated)',
				placeHolder: 'e.g., REST conventions, Error responses, Input validation'
			});
			if (!focusInput) { return; }

			const severityPick = await vscode.window.showQuickPick(
				['lenient', 'balanced', 'strict'],
				{ placeHolder: 'Severity level' }
			);
			if (!severityPick) { return; }

			const newProfile: ReviewProfile = {
				name,
				description: description || name,
				focusAreas: focusInput.split(',').map(s => s.trim()).filter(Boolean),
				severity: severityPick as 'lenient' | 'balanced' | 'strict',
				includeExplanations: severityPick !== 'strict'
			};

			await saveCustomProfile(context, newProfile);
			await setActiveProfileName(context, name);
			updateProfileStatusBar(profileStatusBarItem, context);
			vscode.window.showInformationMessage(`Created and activated profile: ${name}`);
			return;
		}

		if (selected.profileName === '__delete__') {
			const customProfiles = getAllProfiles(context).filter(
				p => !BUILTIN_PROFILES.some(b => b.name === p.name) && !COMPLIANCE_PROFILES.some(c => c.name === p.name)
			);
			if (customProfiles.length === 0) {
				vscode.window.showInformationMessage('No custom profiles to delete.');
				return;
			}
			const toDelete = await vscode.window.showQuickPick(
				customProfiles.map(p => ({ label: p.name, description: p.description })),
				{ placeHolder: 'Select a custom profile to delete' }
			);
			if (toDelete) {
				const deleted = await deleteCustomProfile(context, toDelete.label);
				if (deleted) {
					updateProfileStatusBar(profileStatusBarItem, context);
					vscode.window.showInformationMessage(`Deleted profile: ${toDelete.label}`);
				}
			}
			return;
		}

		await setActiveProfileName(context, selected.profileName);
		updateProfileStatusBar(profileStatusBarItem, context);
		vscode.window.showInformationMessage(`Review profile changed to: ${selected.profileName}`);
	});
	context.subscriptions.push(selectProfileCommand);

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
			{ label: 'MiniMax-M2.5', description: 'MiniMax M2.5 (MiniMax)' },
			{ label: 'openai-compatible', description: 'OpenAI-compatible endpoint (LM Studio, vLLM, LocalAI, Groq, OpenRouter…)' },
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

				// If OpenAI-compatible is selected, prompt for endpoint and model
				if (selected.label === 'openai-compatible') {
					await showOpenAICompatiblePicker(config);
					await config.update('model', 'openai-compatible', vscode.ConfigurationTarget.Global);
					updateModelStatusBar(modelStatusBarItem);
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

				// If OpenAI-compatible is selected, prompt for endpoint and model
				if (selected.label === 'openai-compatible') {
					await showOpenAICompatiblePicker(config);
					await config.update('model', 'openai-compatible', vscode.ConfigurationTarget.Global);
					updateModelStatusBar(modelStatusBarItem);
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
					progress.report({ message: 'Fetching skills from configured repositories...' });

					const skills = await skillsService.fetchAvailableSkillsFromAllRepos(true);

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

	// Apply Skill to Code Review Command (supports multiple skills)
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

			// Get currently selected skills to pre-select them
			const currentlySelected = context.globalState.get<any[]>('selectedSkills', []);
			const currentlySelectedNames = new Set(currentlySelected.map(s => `${s.repository}/${s.name}`));

			const selectedSkills = await vscode.window.showQuickPick(
				cachedSkills.map(skill => ({
					label: skill.name,
					description: `${skill.description} (${skill.repository})`,
					skill: skill,
					picked: currentlySelectedNames.has(`${skill.repository}/${skill.name}`)
				})),
				{
					placeHolder: 'Select skills to apply to code review (multiple allowed)',
					canPickMany: true
				}
			);

			if (selectedSkills && selectedSkills.length > 0) {
				const skillNames = selectedSkills.map(s => s.skill.name).join(', ');
				vscode.window.showInformationMessage(
					`${selectedSkills.length} skill(s) will be applied to next review: ${skillNames}`
				);
				// Store selected skills array for next review
				context.globalState.update('selectedSkills', selectedSkills.map(s => s.skill));
			} else if (selectedSkills && selectedSkills.length === 0) {
				// User explicitly deselected all skills
				vscode.window.showInformationMessage('All skills have been deselected');
				context.globalState.update('selectedSkills', []);
			}
		}
	);

	// Clear Selected Skills Command
	const clearSkillsCommand = vscode.commands.registerCommand(
		'ollama-code-review.clearSelectedSkills',
		async () => {
			const currentSkills = context.globalState.get<any[]>('selectedSkills', []);
			if (currentSkills.length === 0) {
				vscode.window.showInformationMessage('No skills are currently selected');
				return;
			}
			context.globalState.update('selectedSkills', []);
			vscode.window.showInformationMessage(`Cleared ${currentSkills.length} selected skill(s)`);
		}
	);

	context.subscriptions.push(browseSkillsCommand, applySkillCommand, clearSkillsCommand);
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

	// Review GitHub PR command (F-004)
	const reviewGitHubPRCommand = vscode.commands.registerCommand('ollama-code-review.reviewGitHubPR', async () => {
		try {
			const gitAPI = getGitAPI();
			let repoPath = '';

			// Try to get repo path for context detection
			if (gitAPI) {
				const repo = await selectRepository(gitAPI);
				if (repo) {
					repoPath = repo.rootUri.fsPath;
				}
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama Code Review',
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: 'Authenticating with GitHub...' });

				const result = await promptAndFetchPR(repoPath, runGitCommand);
				if (!result || token.isCancellationRequested) { return; }

				const { diff, ref, info, auth } = result;

				outputChannel.appendLine(`\n--- Reviewing GitHub PR #${ref.prNumber} ---`);
				outputChannel.appendLine(`Title: ${info.title}`);
				outputChannel.appendLine(`Author: ${info.user}`);
				outputChannel.appendLine(`Branch: ${info.headBranch} → ${info.baseBranch}`);
				outputChannel.appendLine(`Changed files: ${info.changedFiles} (+${info.additions}/-${info.deletions})`);
				outputChannel.appendLine('---------------------------------------');

				progress.report({ message: `Reviewing PR #${ref.prNumber}: ${info.title}...` });

				// Store PR context for later "Post to PR" action
				context.globalState.update('activePRContext', {
					owner: ref.owner,
					repo: ref.repo,
					prNumber: ref.prNumber,
					title: info.title,
					url: info.url
				});

				// Use the existing runReview workflow
				await runReview(diff, context);
			});
		} catch (error) {
			handleError(error, 'Failed to review GitHub PR.');
		}
	});

	// Post Review to GitHub PR command (F-004)
	const postReviewToPRCommand = vscode.commands.registerCommand('ollama-code-review.postReviewToPR', async () => {
		try {
			const prContext = context.globalState.get<{
				owner: string;
				repo: string;
				prNumber: number;
				title: string;
				url: string;
			}>('activePRContext');

			if (!prContext) {
				vscode.window.showErrorMessage(
					'No active PR context. Please run "Review GitHub PR" first.'
				);
				return;
			}

			const panel = OllamaReviewPanel.currentPanel;
			if (!panel) {
				vscode.window.showErrorMessage('No review panel open. Please run a review first.');
				return;
			}

			const reviewContent = panel.getReviewContent();
			if (!reviewContent) {
				vscode.window.showErrorMessage('No review content available.');
				return;
			}

			const auth = await getGitHubAuth(true);
			if (!auth) {
				await showAuthSetupGuide();
				return;
			}

			const config = vscode.workspace.getConfiguration('ollama-code-review');
			const commentStyle = config.get<string>('github.commentStyle', 'summary');
			const model = getOllamaModel(config);

			const ref: PRReference = {
				owner: prContext.owner,
				repo: prContext.repo,
				prNumber: prContext.prNumber
			};

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Posting review to GitHub...',
				cancellable: false
			}, async (progress) => {
				let commentUrl: string;

				if (commentStyle === 'summary') {
					progress.report({ message: 'Posting summary comment...' });
					commentUrl = await postPRSummaryComment(ref, auth, reviewContent, model);
				} else {
					// 'inline' or 'both' — parse findings and create a proper review
					progress.report({ message: 'Parsing review findings...' });
					const originalDiff = panel.getOriginalDiff();
					const findings = parseReviewIntoFindings(reviewContent, originalDiff);

					progress.report({ message: `Posting review with ${findings.length} findings...` });
					commentUrl = await postPRReview(
						ref,
						auth,
						commentStyle === 'both' ? findings : findings.filter(f => f.file && f.line),
						reviewContent,
						model
					);
				}

				const action = await vscode.window.showInformationMessage(
					`Review posted to PR #${prContext.prNumber}!`,
					'Open in Browser',
					'Copy URL'
				);

				if (action === 'Open in Browser') {
					vscode.env.openExternal(vscode.Uri.parse(commentUrl));
				} else if (action === 'Copy URL') {
					await vscode.env.clipboard.writeText(commentUrl);
				}
			});
		} catch (error) {
			handleError(error, 'Failed to post review to GitHub PR.');
		}
	});

	// F-006 (remainder): Reload project config command
	const reloadProjectConfigCommand = vscode.commands.registerCommand(
		'ollama-code-review.reloadProjectConfig',
		() => {
			clearProjectConfigCache();
			vscode.window.showInformationMessage('Ollama Code Review: .ollama-review.yaml config reloaded.');
			outputChannel.appendLine('[Ollama Code Review] Project config cache cleared. Will re-read .ollama-review.yaml on next review.');
		}
	);

	// F-006 (remainder): Watch .ollama-review.yaml for changes and auto-invalidate the cache
	const yamlConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.ollama-review.yaml');
	yamlConfigWatcher.onDidChange(() => {
		clearProjectConfigCache();
		outputChannel.appendLine('[Ollama Code Review] .ollama-review.yaml changed — config cache invalidated.');
	});
	yamlConfigWatcher.onDidCreate(() => {
		clearProjectConfigCache();
		outputChannel.appendLine('[Ollama Code Review] .ollama-review.yaml created — config cache invalidated.');
	});
	yamlConfigWatcher.onDidDelete(() => {
		clearProjectConfigCache();
		outputChannel.appendLine('[Ollama Code Review] .ollama-review.yaml deleted — config cache invalidated.');
	});

	// F-014: Pre-Commit Guard — status bar item
	const guardStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	guardStatusBarItem.command = 'ollama-code-review.togglePreCommitGuard';
	function updateGuardStatusBar() {
		const gitAPI = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1);
		const repo = gitAPI?.repositories?.[0];
		if (repo) {
			const installed = isHookInstalled(repo.rootUri.fsPath);
			guardStatusBarItem.text = installed ? '$(shield) Guard ON' : '$(shield) Guard OFF';
			guardStatusBarItem.tooltip = installed
				? 'Ollama Pre-Commit Guard is active — click to disable'
				: 'Ollama Pre-Commit Guard is inactive — click to enable';
			guardStatusBarItem.show();
		} else {
			guardStatusBarItem.hide();
		}
	}
	updateGuardStatusBar();

	// F-014: Toggle Pre-Commit Guard command
	const togglePreCommitGuardCommand = vscode.commands.registerCommand(
		'ollama-code-review.togglePreCommitGuard',
		async () => {
			try {
				const gitAPI = getGitAPI();
				if (!gitAPI) { return; }
				const repo = await selectRepository(gitAPI);
				if (!repo) {
					vscode.window.showInformationMessage('No Git repository found.');
					return;
				}
				const repoPath = repo.rootUri.fsPath;

				if (isHookInstalled(repoPath)) {
					const result = uninstallHook(repoPath);
					if (result.success) {
						vscode.window.showInformationMessage('Pre-commit guard disabled.');
						outputChannel.appendLine('[Pre-Commit Guard] Hook removed.');
					} else {
						vscode.window.showWarningMessage(result.message);
					}
				} else {
					const result = installHook(repoPath);
					if (result.success) {
						vscode.window.showInformationMessage(
							'Pre-commit guard enabled. Use "Ollama: Review & Commit" to commit with AI review.'
						);
						outputChannel.appendLine('[Pre-Commit Guard] Hook installed.');
					} else {
						vscode.window.showWarningMessage(result.message);
					}
				}
				updateGuardStatusBar();
			} catch (error) {
				handleError(error, 'Failed to toggle pre-commit guard.');
			}
		}
	);

	// F-016: Review Quality Score — status bar item (priority 97, just left of guard)
	scoreStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
	scoreStatusBarItem.command = 'ollama-code-review.showReviewHistory';
	scoreStatusBarItem.tooltip = 'Review Quality Score — click to view history';
	// Don't show until first review completes

	// Set global storage path for score persistence
	extensionGlobalStoragePath = context.globalStorageUri.fsPath;

	// F-016: Show Review History command
	const showReviewHistoryCommand = vscode.commands.registerCommand(
		'ollama-code-review.showReviewHistory',
		() => {
			const store = ReviewScoreStore.getInstance(context.globalStorageUri.fsPath);
			ReviewHistoryPanel.createOrShow(store.getScores(100));
		}
	);
	context.subscriptions.push(showReviewHistoryCommand, scoreStatusBarItem);

	// F-019: Batch / Legacy Code Review — Review File command
	const reviewFileCommand = vscode.commands.registerCommand(
		'ollama-code-review.reviewFile',
		async (uri?: vscode.Uri) => {
			const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!fileUri) {
				vscode.window.showWarningMessage('Open a file or right-click a file in the Explorer to review it.');
				return;
			}
			try {
				const bytes = await vscode.workspace.fs.readFile(fileUri);
				const content = Buffer.from(bytes).toString('utf-8');
				const relativePath = vscode.workspace.asRelativePath(fileUri);
				const maxKb = vscode.workspace.getConfiguration('ollama-code-review').get<number>('batch.maxFileSizeKb', 100);
				if (content.length > maxKb * 1024) {
					vscode.window.showWarningMessage(`File is larger than ${maxKb} KB. Only the first ${maxKb} KB will be reviewed.`);
				}
				const truncated = content.slice(0, maxKb * 1024);
				await runFileReview(truncated, `[File Review: ${relativePath}]`, context);
			} catch (error) {
				handleError(error, 'Failed to review file.');
			}
		}
	);
	context.subscriptions.push(reviewFileCommand);

	// F-019: Batch / Legacy Code Review — Review Folder command
	const reviewFolderCommand = vscode.commands.registerCommand(
		'ollama-code-review.reviewFolder',
		async (uri?: vscode.Uri) => {
			const folderUri = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!folderUri) {
				vscode.window.showWarningMessage('Open a folder or right-click a folder in the Explorer to review it.');
				return;
			}
			try {
				const cfg = vscode.workspace.getConfiguration('ollama-code-review');
				const includeGlob = cfg.get<string>('batch.includeGlob', '**/*.{ts,js,tsx,jsx,py,go,java,php,rb,cs,cpp,c,h}');
				const excludeGlob = cfg.get<string>('batch.excludeGlob', '**/node_modules/**,**/dist/**,**/build/**,**/out/**');
				const maxKb = cfg.get<number>('batch.maxFileSizeKb', 100);

				const pattern = new vscode.RelativePattern(folderUri, includeGlob);
				const files = await vscode.workspace.findFiles(pattern, `{${excludeGlob}}`, 50);

				if (files.length === 0) {
					vscode.window.showInformationMessage('No matching files found in the selected folder.');
					return;
				}

				const relativeFolderPath = vscode.workspace.asRelativePath(folderUri);
				let combined = '';
				let totalChars = 0;
				const budgetChars = maxKb * 1024 * 10; // Allow up to 10× maxKb for folder reviews

				for (const file of files) {
					if (totalChars >= budgetChars) { break; }
					try {
						const bytes = await vscode.workspace.fs.readFile(file);
						const content = Buffer.from(bytes).toString('utf-8').slice(0, maxKb * 1024);
						const rel = vscode.workspace.asRelativePath(file);
						combined += `\n--- ${rel} ---\n${content}\n`;
						totalChars += content.length;
					} catch {
						// Skip unreadable files
					}
				}

				if (!combined.trim()) {
					vscode.window.showInformationMessage('Could not read any files in the selected folder.');
					return;
				}

				await runFileReview(combined.trim(), `[Folder Review: ${relativeFolderPath} — ${files.length} file(s)]`, context);
			} catch (error) {
				handleError(error, 'Failed to review folder.');
			}
		}
	);
	context.subscriptions.push(reviewFolderCommand);

	// F-019: Batch / Legacy Code Review — Review Selection command
	const reviewSelectionCommand = vscode.commands.registerCommand(
		'ollama-code-review.reviewSelection',
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.selection.isEmpty) {
				vscode.window.showWarningMessage('Select some code first, then run "Review Selection".');
				return;
			}
			const selectedText = editor.document.getText(editor.selection);
			const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
			const startLine = editor.selection.start.line + 1;
			const endLine = editor.selection.end.line + 1;
			await runFileReview(
				selectedText,
				`[Selection Review: ${relativePath} lines ${startLine}–${endLine}]`,
				context
			);
		}
	);
	context.subscriptions.push(reviewSelectionCommand);

	// F-014: Review & Commit command
	const reviewAndCommitCommand = vscode.commands.registerCommand(
		'ollama-code-review.reviewAndCommit',
		async () => {
			try {
				const gitAPI = getGitAPI();
				if (!gitAPI) { return; }
				const repo = await selectRepository(gitAPI);
				if (!repo) {
					vscode.window.showInformationMessage('No Git repository found.');
					return;
				}
				const repoPath = repo.rootUri.fsPath;

				const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);
				if (!diffResult || !diffResult.trim()) {
					vscode.window.showInformationMessage('No staged changes to review and commit.');
					return;
				}

				const guardConfig = getPreCommitGuardConfig();

				// Run AI review with progress and timeout
				const review = await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Ollama: Review & Commit',
					cancellable: true
				}, async (progress, token) => {
					// F-008: Gather multi-file context for Review & Commit
					let rcContextBundle: ContextBundle | undefined;
					const rcCtxConfig = getContextGatheringConfig();
					if (rcCtxConfig.enabled) {
						progress.report({ message: 'Gathering related file context…' });
						try {
							rcContextBundle = await gatherContext(diffResult, rcCtxConfig, outputChannel);
						} catch {
							// Non-fatal — continue without context
						}
					}

					progress.report({ message: 'Running AI review on staged changes...' });

					// Race the review against the configured timeout
					const timeoutMs = guardConfig.timeout * 1000;
					const reviewPromise = getOllamaReview(diffResult, context, rcContextBundle);
					const timeoutPromise = new Promise<null>((resolve) =>
						setTimeout(() => resolve(null), timeoutMs)
					);
					const cancellationPromise = new Promise<null>((resolve) => {
						token.onCancellationRequested(() => resolve(null));
					});

					const result = await Promise.race([reviewPromise, timeoutPromise, cancellationPromise]);

					if (token.isCancellationRequested) {
						return undefined; // User cancelled
					}
					if (result === null) {
						vscode.window.showWarningMessage(
							`AI review timed out after ${guardConfig.timeout}s. You can increase the timeout in settings or commit with --no-verify.`
						);
						return undefined;
					}
					return result as string;
				});

				if (!review) { return; } // Cancelled or timed out

				// Assess severity
				const assessment = assessSeverity(review, diffResult, guardConfig.severityThreshold);
				const summary = formatAssessmentSummary(assessment);

				if (assessment.pass) {
					// Below threshold — show review and offer to commit
					outputChannel.appendLine('[Pre-Commit Guard] Review passed threshold check.');

					const action = await vscode.window.showInformationMessage(
						`Pre-commit review passed (threshold: ${assessment.threshold}).\n${summary}`,
						{ modal: true },
						'Commit',
						'View Review',
						'Cancel'
					);

					if (action === 'Commit') {
						await performCommit(repo, repoPath);
					} else if (action === 'View Review') {
						const metrics = getLastPerformanceMetrics();
						OllamaReviewPanel.createOrShow(review, diffResult, context, metrics);
					}
				} else {
					// Above threshold — show findings, offer options
					outputChannel.appendLine(`[Pre-Commit Guard] Review BLOCKED — ${assessment.blockingFindings.length} finding(s) at or above "${assessment.threshold}".`);

					const action = await vscode.window.showWarningMessage(
						`Pre-commit review found issues:\n${summary}`,
						{ modal: true },
						'View Review',
						'Commit Anyway',
						'Cancel'
					);

					if (action === 'Commit Anyway') {
						await performCommit(repo, repoPath);
					} else if (action === 'View Review') {
						const metrics = getLastPerformanceMetrics();
						OllamaReviewPanel.createOrShow(review, diffResult, context, metrics);
					}
				}
			} catch (error) {
				handleError(error, 'Failed to complete Review & Commit.');
			}
		}
	);

	/** Helper: Perform the actual git commit, creating a bypass file if the hook is installed. */
	async function performCommit(repo: any, repoPath: string) {
		const hookActive = isHookInstalled(repoPath);
		try {
			if (hookActive) {
				createBypassFile(repoPath);
			}
			// Use the SCM input box value as the commit message, or prompt for one
			let commitMessage = repo.inputBox?.value?.trim();
			if (!commitMessage) {
				commitMessage = await vscode.window.showInputBox({
					prompt: 'Enter commit message',
					placeHolder: 'feat: describe your changes',
					ignoreFocusOut: true
				});
			}
			if (!commitMessage) {
				removeBypassFile(repoPath);
				return; // User cancelled
			}

			await runGitCommand(repoPath, ['commit', '-m', commitMessage]);
			// Clear the SCM input box after successful commit
			if (repo.inputBox) {
				repo.inputBox.value = '';
			}
			vscode.window.showInformationMessage('Changes committed successfully.');
			outputChannel.appendLine(`[Pre-Commit Guard] Committed: ${commitMessage}`);
		} catch (error) {
			handleError(error, 'Commit failed.');
		} finally {
			if (hookActive) {
				removeBypassFile(repoPath);
			}
		}
	}

	context.subscriptions.push(
		reviewStagedChangesCommand,
		reviewCommitRangeCommand,
		reviewChangesBetweenTwoBranchesCommand,
		generateCommitMessageCommand,
		suggestRefactoringCommand,
		reviewCommitCommand,
		reviewGitHubPRCommand,
		postReviewToPRCommand,
		reloadProjectConfigCommand,
		yamlConfigWatcher,
		togglePreCommitGuardCommand,
		reviewAndCommitCommand,
		guardStatusBarItem
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

	// Apply diff filtering (config hierarchy: defaults → settings → .ollama-review.yaml)
	const filterConfig = await getDiffFilterConfigWithYaml(outputChannel);
	const filterResult = filterDiff(diff, filterConfig);
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
		// F-008: Gather multi-file context (imports, tests, type definitions)
		let contextBundle: ContextBundle | undefined;
		const ctxConfig = getContextGatheringConfig();
		if (ctxConfig.enabled) {
			progress.report({ message: 'Gathering related file context…' });
			try {
				contextBundle = await gatherContext(filteredDiff, ctxConfig, outputChannel);
			} catch (err) {
				// Non-fatal — continue review without context
				outputChannel.appendLine(`[Context Gathering] Error: ${err}`);
			}
		}

		progress.report({ message: `Asking Ollama for a review (${filterResult.stats.includedFiles} files)...` });
		const review = await getOllamaReview(filteredDiff, context, contextBundle);

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

		// Attach active profile to metrics for display
		if (metrics) {
			metrics.activeProfile = getActiveProfileName(context);
		}

		// F-016: Compute quality score and persist to history
		const findingCounts = parseFindingCounts(review);
		const scoreResult = computeScore(findingCounts);
		if (extensionGlobalStoragePath) {
			const store = ReviewScoreStore.getInstance(extensionGlobalStoragePath);
			const gitAPI = getGitAPI();
			const repo = gitAPI?.repositories?.[0];
			const repoName = repo?.rootUri
				? vscode.workspace.asRelativePath(repo.rootUri)
				: 'unknown';
			let branch = 'unknown';
			try { branch = repo?.state?.HEAD?.name ?? 'unknown'; } catch { /* ignore */ }
			const scoreEntry: ReviewScore = {
				id: Date.now().toString(),
				timestamp: new Date().toISOString(),
				repo: repoName,
				branch,
				model: metrics?.model ?? getOllamaModel(vscode.workspace.getConfiguration('ollama-code-review')),
				profile: getActiveProfileName(context) ?? 'general',
				...scoreResult,
				findingCounts,
			};
			store.addScore(scoreEntry);
			outputChannel.appendLine(`[Score] Quality score: ${scoreResult.score}/100 (${findingCounts.critical}C ${findingCounts.high}H ${findingCounts.medium}M ${findingCounts.low}L)`);
		}

		// F-016: Update score status bar
		if (scoreStatusBarItem) {
			updateScoreStatusBar(scoreStatusBarItem, scoreResult.score);
			scoreStatusBarItem.show();
		}

		// F-018: Send notifications (non-blocking, failures are logged)
		{
			const cfg = vscode.workspace.getConfiguration('ollama-code-review');
			const notifPayload: NotificationPayload = {
				reviewText: review,
				model: metrics?.model ?? getOllamaModel(cfg),
				profile: getActiveProfileName(context) ?? 'general',
				score: scoreResult.score,
				findingCounts,
			};
			// Attempt to get branch for notification label
			try {
				const gitAPI = getGitAPI();
				const repo = gitAPI?.repositories?.[0];
				notifPayload.branch = repo?.state?.HEAD?.name ?? undefined;
				notifPayload.repoName = repo?.rootUri
					? vscode.workspace.asRelativePath(repo.rootUri)
					: undefined;
			} catch { /* ignore */ }
			sendNotifications(notifPayload, outputChannel).catch(() => { /* already logged inside */ });
		}

		progress.report({ message: "Displaying review..." });
		OllamaReviewPanel.createOrShow(review, filteredDiff, context, metrics);
	});
}

/**
 * F-019: Run a review on arbitrary file/folder/selection content (no Git diff required).
 *
 * Bypasses diff filtering and uses a simpler file-review prompt so the model
 * knows there is no diff context. Integrates with F-016 scoring and F-018 notifications.
 */
async function runFileReview(content: string, label: string, context: vscode.ExtensionContext) {
	if (!content || !content.trim()) {
		vscode.window.showInformationMessage('No content to review.');
		return;
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Ollama Code Review",
		cancellable: false,
	}, async (progress) => {
		progress.report({ message: `${label} — asking AI for review…` });

		// Use a file-review flavoured prompt that does not mention git diff format
		const review = await getOllamaFileReview(content, label, context);

		// F-016: Score
		const findingCounts = parseFindingCounts(review);
		const scoreResult = computeScore(findingCounts);
		if (extensionGlobalStoragePath) {
			const store = ReviewScoreStore.getInstance(extensionGlobalStoragePath);
			const scoreEntry: ReviewScore = {
				id: Date.now().toString(),
				timestamp: new Date().toISOString(),
				repo: 'local',
				branch: 'n/a',
				model: getOllamaModel(vscode.workspace.getConfiguration('ollama-code-review')),
				profile: getActiveProfileName(context) ?? 'general',
				label,
				...scoreResult,
				findingCounts,
			};
			store.addScore(scoreEntry);
		}
		if (scoreStatusBarItem) {
			updateScoreStatusBar(scoreStatusBarItem, scoreResult.score);
			scoreStatusBarItem.show();
		}

		// F-018: Notifications
		const notifPayload: NotificationPayload = {
			reviewText: review,
			model: getOllamaModel(vscode.workspace.getConfiguration('ollama-code-review')),
			profile: getActiveProfileName(context) ?? 'general',
			score: scoreResult.score,
			findingCounts,
			label,
		};
		sendNotifications(notifPayload, outputChannel).catch(() => { /* already logged inside */ });

		progress.report({ message: "Displaying review..." });
		// Show review panel — pass content as the "diff" so follow-up chat has it as context
		const metrics = getLastPerformanceMetrics();
		OllamaReviewPanel.createOrShow(review, content, context, metrics ?? undefined);
	});
}

/**
 * Build and execute a file-review prompt (no git diff context).
 * Reuses the AI provider routing from getOllamaReview().
 */
async function getOllamaFileReview(content: string, label: string, context?: vscode.ExtensionContext): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0);
	const frameworksList = (await getEffectiveFrameworks(outputChannel)).join(', ');

	let skillContext = '';
	if (context) {
		const selectedSkills = context.globalState.get<any[]>('selectedSkills', []);
		if (selectedSkills?.length > 0) {
			const skillContents = selectedSkills.map((skill, i) =>
				`### Skill ${i + 1}: ${skill.name}\n${skill.content}`
			).join('\n\n');
			skillContext = `\n\nAdditional Review Guidelines (${selectedSkills.length} skill(s) applied):\n${skillContents}\n`;
		}
	}

	let profileContext = '';
	if (context) {
		const profile = getActiveProfile(context);
		profileContext = buildProfilePromptContext(profile);
	}

	const prompt = `You are an expert software engineer and code reviewer with deep knowledge of **${frameworksList}**.
${skillContext}${profileContext}
Review the following code and provide constructive, actionable feedback. This is a direct file review (no git diff context).
${label}

**Review Focus:**
- Potential bugs or logical errors
- Security vulnerabilities
- Performance issues
- Code style and readability
- Maintainability concerns

Use Markdown for formatting. For each finding include a severity badge (🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low) and a concrete suggestion.

If you find no issues, respond with: "I have reviewed the code and found no significant issues."

Code to review:
\`\`\`
${content}
\`\`\``;

	clearPerformanceMetrics();

	if (isClaudeModel(model))              { return await callClaudeAPI(prompt, config, true); }
	if (isGlmModel(model))                 { return await callGlmAPI(prompt, config, true); }
	if (isHuggingFaceModel(model))         { return await callHuggingFaceAPI(prompt, config, true); }
	if (isGeminiModel(model))              { return await callGeminiAPI(prompt, config, true); }
	if (isMistralModel(model))             { return await callMistralAPI(prompt, config, true); }
	if (isMiniMaxModel(model))             { return await callMiniMaxAPI(prompt, config, true); }
	if (isOpenAICompatibleModel(model))    { return await callOpenAICompatibleAPI(prompt, config, true); }

	// Ollama
	const response = await axios.post(endpoint, {
		model,
		prompt,
		stream: false,
		options: { temperature },
	});
	return response.data?.response ?? '';
}

async function getOllamaReview(diff: string, context?: vscode.ExtensionContext, contextBundle?: ContextBundle): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0);
	// Resolve frameworks using config hierarchy (settings → .ollama-review.yaml overrides)
	const frameworksList = (await getEffectiveFrameworks(outputChannel)).join(', ');
	let skillContext = '';

	if (context) {
		const selectedSkills = context.globalState.get<any[]>('selectedSkills', []);
		if (selectedSkills && selectedSkills.length > 0) {
			const skillContents = selectedSkills.map((skill, index) =>
				`### Skill ${index + 1}: ${skill.name}\n${skill.content}`
			).join('\n\n');
			skillContext = `\n\nAdditional Review Guidelines (${selectedSkills.length} skill(s) applied):\n${skillContents}\n`;
		}
	}

	// Build profile context
	let profileContext = '';
	if (context) {
		const profile = getActiveProfile(context);
		profileContext = buildProfilePromptContext(profile);
	}

	// Resolve review prompt using config hierarchy: default → settings → .ollama-review.yaml
	const promptTemplate = await getEffectiveReviewPrompt(DEFAULT_REVIEW_PROMPT, outputChannel);

	const variables: Record<string, string> = {
		code: diff,
		frameworks: frameworksList,
		skills: skillContext,
		profile: profileContext,
	};

	let prompt = resolvePrompt(promptTemplate, variables);

	// Safety: if the user's custom template omits ${skills} but skills are active, append them
	if (skillContext && !promptTemplate.includes('${skills}')) {
		prompt += '\n' + skillContext;
	}

	// F-008: Append multi-file context if available
	if (contextBundle && contextBundle.files.length > 0) {
		const contextSection = formatContextForPrompt(contextBundle);
		prompt += '\n' + contextSection;
	}

	// Safety: if the user's custom template omits ${profile} but a non-general profile is active, append it
	if (profileContext && !promptTemplate.includes('${profile}')) {
		prompt += '\n' + profileContext;
	}


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

		// Use MiniMax API if a MiniMax model is selected
		if (isMiniMaxModel(model)) {
			return await callMiniMaxAPI(prompt, config, true);
		}

		// Use OpenAI-compatible API if selected
		if (isOpenAICompatibleModel(model)) {
			return await callOpenAICompatibleAPI(prompt, config, true);
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

	// Resolve commit prompt using config hierarchy: default → settings → .ollama-review.yaml
	const promptTemplate = await getEffectiveCommitPrompt(DEFAULT_COMMIT_MESSAGE_PROMPT, outputChannel);

	const variables: Record<string, string> = {
		diff: diff,
		draftMessage: existingMessage && existingMessage.trim() ? existingMessage : '(none provided)',
	};

	const prompt = resolvePrompt(promptTemplate, variables);

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
		} else if (isMiniMaxModel(model)) {
			// Use MiniMax API if a MiniMax model is selected
			message = await callMiniMaxAPI(prompt, config);
		} else if (isOpenAICompatibleModel(model)) {
			// Use OpenAI-compatible API if selected
			message = await callOpenAICompatibleAPI(prompt, config);
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

		// Use MiniMax API if a MiniMax model is selected
		if (isMiniMaxModel(model)) {
			return await callMiniMaxAPI(prompt, config);
		}

		// Use OpenAI-compatible API if selected
		if (isOpenAICompatibleModel(model)) {
			return await callOpenAICompatibleAPI(prompt, config);
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

	if (isMiniMaxModel(model)) {
		return await callMiniMaxAPI(prompt, config);
	}

	if (isOpenAICompatibleModel(model)) {
		return await callOpenAICompatibleAPI(prompt, config);
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
		} else if (url.includes('api.minimax.io')) {
			const minimaxError = responseData?.error?.message || responseData?.message || error.message;
			errorMessage += `MiniMax API Error (${status}): ${minimaxError}`;
			if (status === 429) {
				errorMessage += '\nRate limit exceeded. Please wait and try again.';
			}
		} else if (url.includes('/chat/completions') && !url.includes('localhost:11434')) {
			// OpenAI-compatible provider
			const oaiError = responseData?.error?.message || responseData?.message || error.message;
			errorMessage += `OpenAI-compatible API Error (${status}): ${oaiError}`;
			if (!status || error.code === 'ECONNREFUSED') {
				errorMessage += '\nMake sure your server (LM Studio, vLLM, LocalAI, etc.) is running.';
				errorMessage += '\nCheck the endpoint in Settings > Ollama Code Review > OpenAI Compatible > Endpoint';
			} else if (status === 429) {
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

	// Dispose skills service (clears in-memory caches)
	if (skillsServiceInstance) {
		skillsServiceInstance.dispose();
		skillsServiceInstance = null;
	}

	// Dispose output channel
	if (outputChannel) {
		outputChannel.dispose();
	}
}
