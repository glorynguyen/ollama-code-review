import { callClaudeAPI, isClaudeModel, streamClaudeAPI } from '../commands/providerClients';
import type { GenerateOptions, ModelProvider, ProviderRequestContext, StreamOptions } from './types';

export class ClaudeProvider implements ModelProvider {
	public readonly name = 'claude';

	public isMatch(model: string): boolean {
		return isClaudeModel(model);
	}

	public async isAvailable(): Promise<boolean> {
		return true;
	}

	public supportsStreaming(): boolean {
		return true;
	}

	public async generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string> {
		return callClaudeAPI(prompt, context.config, !!options?.captureMetrics);
	}

	public async stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string> {
		return streamClaudeAPI(prompt, context.config, options.onChunk);
	}
}
