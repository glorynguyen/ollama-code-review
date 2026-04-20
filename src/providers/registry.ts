import { ClaudeProvider } from './claude';
import { GeminiProvider } from './gemini';
import { GlmProvider } from './glm';
import { HuggingFaceProvider } from './huggingface';
import { MiniMaxProvider } from './minimax';
import { MistralProvider } from './mistral';
import { OllamaProvider } from './ollama';
import { OpenAICompatibleProvider } from './openaiCompatible';
import { V0Provider } from './v0';
import type { ModelProvider } from './types';

export interface ModelMetadata {
	id: string;
	label: string;
	description: string;
}

export const CLOUD_MODELS_METADATA: ModelMetadata[] = [
	{ id: 'v0-auto', label: 'v0 Auto', description: 'Automatically selects the best model for the task (Vercel)' },
	{ id: 'v0-mini', label: 'v0 Mini', description: 'Small and fast model (Vercel)' },
	{ id: 'v0-pro', label: 'v0 Pro', description: 'Powerful coding model (Vercel)' },
	{ id: 'v0-max', label: 'v0 Max', description: 'Most capable model (Vercel)' },
	{ id: 'v0-max-fast', label: 'v0 Max Fast', description: 'High-speed variant of v0 Max (Vercel)' },
	{ id: 'kimi-k2.5:cloud', label: 'kimi-k2.5:cloud', description: 'Kimi cloud model (Default)' },
	{ id: 'qwen3-coder:480b-cloud', label: 'qwen3-coder:480b-cloud', description: 'Cloud coding model (Qwen)' },
	{ id: 'glm-4.7:cloud', label: 'glm-4.7:cloud', description: 'GLM cloud model (Z.AI)' },
	{ id: 'glm-4.7-flash', label: 'glm-4.7-flash', description: 'GLM 4.7 Flash - Free tier (Z.AI)' },
	{ id: 'huggingface', label: 'huggingface', description: 'Hugging Face Inference API' },
	{ id: 'gemini-1.5-flash', label: 'gemini-1.5-flash', description: 'Gemini 1.5 Flash (Google AI)' },
	{ id: 'gemini-1.5-pro', label: 'gemini-1.5-pro', description: 'Gemini 1.5 Pro (Google AI)' },
	{ id: 'gemini-2.0-flash-exp', label: 'gemini-2.0-flash-exp', description: 'Gemini 2.0 Flash Experimental (Google AI)' },
	{ id: 'mistral-large-latest', label: 'mistral-large-latest', description: 'Mistral Large - Most capable (Mistral AI)' },
	{ id: 'mistral-small-latest', label: 'mistral-small-latest', description: 'Mistral Small - Fast & efficient (Mistral AI)' },
	{ id: 'codestral-latest', label: 'codestral-latest', description: 'Codestral - Optimized for code (Mistral AI)' },
	{ id: 'MiniMax-M2.5', label: 'MiniMax-M2.5', description: 'MiniMax M2.5 (MiniMax)' },
	{ id: 'openai-compatible', label: 'openai-compatible', description: 'OpenAI-compatible endpoint (LM Studio, vLLM, LocalAI, Groq, OpenRouter…)' },
	{ id: 'qwen2.5-coder:14b-instruct-q4_0', label: 'qwen2.5-coder:14b-instruct-q4_0', description: 'Qwen 2.5 Coder 14B local' },
	{ id: 'claude-sonnet-4-20250514', label: 'claude-sonnet-4-20250514', description: 'Claude Sonnet 4 (Anthropic)' },
	{ id: 'claude-opus-4-20250514', label: 'claude-opus-4-20250514', description: 'Claude Opus 4 (Anthropic)' },
	{ id: 'claude-3-7-sonnet-20250219', label: 'claude-3-7-sonnet-20250219', description: 'Claude 3.7 Sonnet (Anthropic)' },
];

export const DEFAULT_MODELS = CLOUD_MODELS_METADATA.map(m => m.id);

export class ProviderRegistry {
	private readonly providers: ModelProvider[] = [];
	private readonly fallbackProviderName = 'ollama';

	public register(provider: ModelProvider): void {
		this.providers.push(provider);
	}

	public resolve(model: string): ModelProvider {
		const fallback = this.getFallbackProvider();
		return this.providers.find(provider => provider !== fallback && provider.isMatch(model)) ?? fallback;
	}

	public async listAvailable(): Promise<ModelProvider[]> {
		const results = await Promise.all(
			this.providers.map(async provider => ({ provider, available: await provider.isAvailable() })),
		);

		return results.filter(result => result.available).map(result => result.provider);
	}

	private getFallbackProvider(): ModelProvider {
		const fallback = this.providers.find(provider => provider.name === this.fallbackProviderName) ?? this.providers[0];
		if (!fallback) {
			throw new Error('No AI providers registered in ProviderRegistry');
		}
		return fallback;
	}
}

export function createDefaultProviderRegistry(): ProviderRegistry {
	const registry = new ProviderRegistry();
	registry.register(new ClaudeProvider());
	registry.register(new GlmProvider());
	registry.register(new HuggingFaceProvider());
	registry.register(new GeminiProvider());
	registry.register(new MistralProvider());
	registry.register(new MiniMaxProvider());
	registry.register(new V0Provider());
	registry.register(new OpenAICompatibleProvider());
	registry.register(new OllamaProvider());
	return registry;
}
