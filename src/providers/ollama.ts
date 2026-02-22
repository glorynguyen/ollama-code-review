import axios from 'axios';
import {
	setLastPerformanceMetrics,
	streamOllamaAPI,
} from '../commands/providerClients';
import type { GenerateOptions, ModelProvider, ProviderRequestContext, StreamOptions } from './types';

export class OllamaProvider implements ModelProvider {
	public readonly name = 'ollama';

	public isMatch(_model: string): boolean {
		// ProviderRegistry treats Ollama as explicit fallback and excludes it from primary matching.
		return true;
	}

	public async isAvailable(): Promise<boolean> {
		return true;
	}

	public supportsStreaming(): boolean {
		return true;
	}

	public async generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string> {
		const response = await axios.post(context.endpoint, {
			model: context.model,
			prompt,
			stream: false,
			options: { temperature: context.temperature },
		});

		if (options?.captureMetrics) {
			const data = response.data;
			const evalDuration = data?.eval_duration || 0;
			const evalCount = data?.eval_count || 0;
			const tokensPerSecond = evalDuration > 0 ? (evalCount / (evalDuration / 1e9)) : undefined;
			const totalDurationSeconds = data?.total_duration ? data.total_duration / 1e9 : undefined;

			setLastPerformanceMetrics({
				provider: 'ollama',
				model: context.model,
				totalDuration: data?.total_duration,
				loadDuration: data?.load_duration,
				promptEvalCount: data?.prompt_eval_count,
				evalCount: data?.eval_count,
				evalDuration: data?.eval_duration,
				tokensPerSecond,
				totalDurationSeconds,
			});
		}

		return response.data?.response?.trim?.() ?? '';
	}

	public async stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string> {
		return streamOllamaAPI(
			prompt,
			context.model,
			context.endpoint,
			context.temperature,
			options.onChunk,
		);
	}
}
