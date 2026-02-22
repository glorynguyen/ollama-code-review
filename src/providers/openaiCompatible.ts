import {
	callOpenAICompatibleAPI,
	isOpenAICompatibleModel,
	streamOpenAICompatibleAPI,
} from '../commands/providerClients';
import type { GenerateOptions, ModelProvider, ProviderRequestContext, StreamOptions } from './types';

export class OpenAICompatibleProvider implements ModelProvider {
	public readonly name = 'openai-compatible';

	public isMatch(model: string): boolean {
		return isOpenAICompatibleModel(model);
	}

	public async isAvailable(): Promise<boolean> {
		return true;
	}

	public supportsStreaming(): boolean {
		return true;
	}

	public async generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string> {
		return callOpenAICompatibleAPI(prompt, context.config, !!options?.captureMetrics);
	}

	public async stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string> {
		return streamOpenAICompatibleAPI(prompt, context.config, options.onChunk);
	}
}
