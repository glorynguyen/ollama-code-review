import { ClaudeProvider } from './claude';
import { GeminiProvider } from './gemini';
import { GlmProvider } from './glm';
import { HuggingFaceProvider } from './huggingface';
import { MiniMaxProvider } from './minimax';
import { MistralProvider } from './mistral';
import { OllamaProvider } from './ollama';
import { OpenAICompatibleProvider } from './openaiCompatible';
import type { ModelProvider } from './types';

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
	registry.register(new OpenAICompatibleProvider());
	registry.register(new OllamaProvider());
	return registry;
}
