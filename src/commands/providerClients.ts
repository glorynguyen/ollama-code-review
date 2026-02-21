import * as vscode from 'vscode';
import axios from 'axios';
import * as https from 'https';
import * as http from 'http';
import { getOllamaModel } from '../utils';

export interface PerformanceMetrics {
	totalDuration?: number;
	loadDuration?: number;
	promptEvalCount?: number;
	evalCount?: number;
	evalDuration?: number;
	hfRateLimitRemaining?: number;
	hfRateLimitReset?: number;
	claudeInputTokens?: number;
	claudeOutputTokens?: number;
	geminiInputTokens?: number;
	geminiOutputTokens?: number;
	mistralInputTokens?: number;
	mistralOutputTokens?: number;
	minimaxInputTokens?: number;
	minimaxOutputTokens?: number;
	openaiCompatibleInputTokens?: number;
	openaiCompatibleOutputTokens?: number;
	tokensPerSecond?: number;
	totalDurationSeconds?: number;
	model?: string;
	provider?: 'ollama' | 'claude' | 'glm' | 'huggingface' | 'gemini' | 'mistral' | 'minimax' | 'openai-compatible';
	activeModel?: {
		name: string;
		sizeVram?: number;
		sizeTotal?: number;
		expiresAt?: string;
	};
	activeProfile?: string;
}

let lastPerformanceMetrics: PerformanceMetrics | null = null;

export function getLastPerformanceMetrics(): PerformanceMetrics | null {
	return lastPerformanceMetrics;
}

export function clearPerformanceMetrics(): void {
	lastPerformanceMetrics = null;
}

export function setLastPerformanceMetrics(metrics: PerformanceMetrics): void {
	lastPerformanceMetrics = metrics;
}

const CLAUDE_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const GLM_API_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';
const HF_API_ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';
const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MISTRAL_API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MINIMAX_API_ENDPOINT = 'https://api.minimax.io/v1/text/chatcompletion_v2';

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
export function isClaudeModel(model: string): boolean {
	return model.startsWith('claude-');
}

/**
 * Check if the model is a GLM model (Z.AI/BigModel API)
 */
export function isGlmModel(model: string): boolean {
	return model.startsWith('glm-');
}

/**
 * Check if the model is a Hugging Face model
 */
export function isHuggingFaceModel(model: string): boolean {
	return model === 'huggingface';
}

/**
 * Check if the model is a Gemini model
 */
export function isGeminiModel(model: string): boolean {
	return model.startsWith('gemini-');
}

/**
 * Check if the model is a Mistral model
 */
export function isMistralModel(model: string): boolean {
	return model.startsWith('mistral-') || model.startsWith('codestral-');
}

/**
 * Check if the model is a MiniMax model
 */
export function isMiniMaxModel(model: string): boolean {
	return model.toLocaleLowerCase().startsWith('minimax-');
}

/**
 * Check if the model is an OpenAI-compatible model (LM Studio, vLLM, LocalAI, Groq, OpenRouter, etc.)
 */
export function isOpenAICompatibleModel(model: string): boolean {
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
export async function callClaudeAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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
export async function callGlmAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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
export async function callHuggingFaceAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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
export async function callGeminiAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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
export async function callMistralAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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
export async function callMiniMaxAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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
export async function callOpenAICompatibleAPI(prompt: string, config: vscode.WorkspaceConfiguration, captureMetrics = false): Promise<string> {
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


// ---------------------------------------------------------------------------
// F-022: Streaming helpers
// ---------------------------------------------------------------------------

/**
 * Stream a review from the Ollama API using NDJSON chunked responses.
 * Each JSON line contains a `response` token and optionally `done` with metrics.
 */
export async function streamOllamaAPI(
	prompt: string,
	model: string,
	endpoint: string,
	temperature: number,
	onChunk: (text: string) => void,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let url: URL;
		try {
			url = new URL(endpoint);
		} catch {
			return reject(new Error(`Invalid Ollama endpoint URL: ${endpoint}`));
		}

		const isHttps = url.protocol === 'https:';
		const lib = isHttps ? https : http;
		const postData = JSON.stringify({ model, prompt, stream: true, options: { temperature } });

		const options = {
			hostname: url.hostname,
			port: url.port ? parseInt(url.port) : (isHttps ? 443 : 80),
			path: url.pathname + url.search,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(postData),
			},
		};

		let fullText = '';
		let buffer = '';

		const req = lib.request(options, (res) => {
			res.on('data', (chunk: Buffer) => {
				buffer += chunk.toString();
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.trim()) { continue; }
					try {
						const data = JSON.parse(line);
						if (data.response) {
							fullText += data.response;
							onChunk(data.response);
						}
						if (data.done) {
							const evalDuration = data.eval_duration ?? 0;
							const evalCount = data.eval_count ?? 0;
							lastPerformanceMetrics = {
								provider: 'ollama',
								model,
								totalDuration: data.total_duration,
								loadDuration: data.load_duration,
								promptEvalCount: data.prompt_eval_count,
								evalCount: data.eval_count,
								evalDuration: data.eval_duration,
								tokensPerSecond: evalDuration > 0 ? (evalCount / (evalDuration / 1e9)) : undefined,
								totalDurationSeconds: data.total_duration ? data.total_duration / 1e9 : undefined,
							};
						}
					} catch { /* ignore malformed JSON lines */ }
				}
			});

			res.on('end', () => {
				if (buffer.trim()) {
					try {
						const data = JSON.parse(buffer);
						if (data.response) { fullText += data.response; onChunk(data.response); }
					} catch { /* ignore */ }
				}
				resolve(fullText);
			});

			res.on('error', reject);
		});

		req.on('error', reject);
		req.write(postData);
		req.end();
	});
}

/**
 * Stream a review from the Anthropic Claude API using SSE.
 */
export async function streamClaudeAPI(
	prompt: string,
	config: vscode.WorkspaceConfiguration,
	onChunk: (text: string) => void,
): Promise<string> {
	const model = getOllamaModel(config);
	const apiKey = config.get<string>('claudeApiKey', '');
	const temperature = config.get<number>('temperature', 0);

	if (!apiKey) {
		throw new Error('Claude API key is not configured. Please set it in Settings > Ollama Code Review > Claude Api Key');
	}

	return new Promise<string>((resolve, reject) => {
		const postData = JSON.stringify({
			model,
			max_tokens: 8192,
			messages: [{ role: 'user', content: prompt }],
			stream: true,
			temperature,
		});

		const options = {
			hostname: 'api.anthropic.com',
			path: '/v1/messages',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				'Content-Length': Buffer.byteLength(postData),
			},
		};

		let fullText = '';
		let buffer = '';
		let inputTokens = 0;
		let outputTokens = 0;

		const req = https.request(options, (res) => {
			if (res.statusCode && res.statusCode >= 400) {
				let body = '';
				res.on('data', (c: Buffer) => { body += c.toString(); });
				res.on('end', () => {
					try {
						const err = JSON.parse(body);
						reject(new Error(`Claude API Error (${res.statusCode}): ${err?.error?.message ?? body}`));
					} catch {
						reject(new Error(`Claude API Error (${res.statusCode}): ${body}`));
					}
				});
				return;
			}

			res.on('data', (chunk: Buffer) => {
				buffer += chunk.toString();
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) { continue; }
					const jsonStr = line.slice(6).trim();
					if (!jsonStr || jsonStr === '[DONE]') { continue; }
					try {
						const data = JSON.parse(jsonStr);
						if (data.type === 'message_start' && data.message?.usage) {
							inputTokens = data.message.usage.input_tokens ?? 0;
						}
						if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
							const text = data.delta.text ?? '';
							if (text) { fullText += text; onChunk(text); }
						}
						if (data.type === 'message_delta' && data.usage) {
							outputTokens = data.usage.output_tokens ?? 0;
						}
					} catch { /* ignore malformed SSE lines */ }
				}
			});

			res.on('end', () => {
				lastPerformanceMetrics = {
					provider: 'claude',
					model,
					claudeInputTokens: inputTokens,
					claudeOutputTokens: outputTokens,
					promptEvalCount: inputTokens,
					evalCount: outputTokens,
				};
				resolve(fullText);
			});

			res.on('error', reject);
		});

		req.on('error', reject);
		req.write(postData);
		req.end();
	});
}

/**
 * Stream a review from any OpenAI-compatible endpoint using SSE.
 */
export async function streamOpenAICompatibleAPI(
	prompt: string,
	config: vscode.WorkspaceConfiguration,
	onChunk: (text: string) => void,
): Promise<string> {
	const endpoint = config.get<string>('openaiCompatible.endpoint', 'http://localhost:1234/v1');
	const apiKey = config.get<string>('openaiCompatible.apiKey', '');
	const model = config.get<string>('openaiCompatible.model', '');
	const temperature = config.get<number>('temperature', 0);

	if (!model) {
		throw new Error(
			'OpenAI-compatible model is not configured.\n' +
			'Please set it in Settings > Ollama Code Review > OpenAI Compatible > Model'
		);
	}

	let url: URL;
	try {
		url = new URL(`${endpoint.replace(/\/$/, '')}/chat/completions`);
	} catch {
		throw new Error(`Invalid OpenAI-compatible endpoint: ${endpoint}`);
	}

	return new Promise<string>((resolve, reject) => {
		const postData = JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: 'You are an expert software engineer and code reviewer.' },
				{ role: 'user', content: prompt },
			],
			stream: true,
			temperature,
			max_tokens: 8192,
		});

		const headers: Record<string, string | number> = {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(postData),
		};
		if (apiKey) { headers['Authorization'] = `Bearer ${apiKey}`; }

		const isHttps = url.protocol === 'https:';
		const lib = isHttps ? https : http;
		const options = {
			hostname: url.hostname,
			port: url.port ? parseInt(url.port) : (isHttps ? 443 : 80),
			path: url.pathname + url.search,
			method: 'POST',
			headers,
		};

		let fullText = '';
		let buffer = '';

		const req = lib.request(options, (res) => {
			res.on('data', (chunk: Buffer) => {
				buffer += chunk.toString();
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) { continue; }
					const jsonStr = line.slice(6).trim();
					if (!jsonStr || jsonStr === '[DONE]') { continue; }
					try {
						const data = JSON.parse(jsonStr);
						const delta = data.choices?.[0]?.delta?.content;
						if (delta) { fullText += delta; onChunk(delta); }
					} catch { /* ignore malformed SSE lines */ }
				}
			});

			res.on('end', () => {
				lastPerformanceMetrics = {
					provider: 'openai-compatible',
					model,
				};
				resolve(fullText);
			});

			res.on('error', reject);
		});

		req.on('error', (err) => {
			if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
				reject(new Error(
					`Could not connect to OpenAI-compatible endpoint at ${endpoint}.\n` +
					'Make sure your server (LM Studio, vLLM, LocalAI, etc.) is running.'
				));
			} else {
				reject(err);
			}
		});
		req.write(postData);
		req.end();
	});
}
