import { callV0API, isV0Model } from '../commands/providerClients';
import { buildProviderPrompt } from './promptFormats';
import type { GenerateOptions, ModelProvider, ProviderRequestContext, StreamOptions } from './types';

export class V0Provider implements ModelProvider {
	public readonly name = 'v0';

	public isMatch(model: string): boolean {
		return isV0Model(model);
	}

	public async isAvailable(): Promise<boolean> {
		return true;
	}

	public supportsStreaming(): boolean {
		return false;
	}

	public async generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string> {
		return callV0API(buildProviderPrompt(prompt, options), context.config, !!options?.captureMetrics);
	}

	public async stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string> {
		const full = await this.generate(prompt, context, options);
		options.onChunk(full);
		return full;
	}
}
