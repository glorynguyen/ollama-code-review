import { callHuggingFaceAPI, isHuggingFaceModel } from '../commands/providerClients';
import type { GenerateOptions, ModelProvider, ProviderRequestContext, StreamOptions } from './types';

export class HuggingFaceProvider implements ModelProvider {
	public readonly name = 'huggingface';

	public isMatch(model: string): boolean {
		return isHuggingFaceModel(model);
	}

	public async isAvailable(): Promise<boolean> {
		return true;
	}

	public supportsStreaming(): boolean {
		return false;
	}

	public async generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string> {
		return callHuggingFaceAPI(prompt, context.config, !!options?.captureMetrics);
	}

	public async stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string> {
		try {
			const full = await this.generate(prompt, context, options);
			options.onChunk(full);
			return full;
		} catch (error) {
			// Intentionally bubble so caller can emit consistent stream-end/error UI events.
			throw error;
		}
	}
}
