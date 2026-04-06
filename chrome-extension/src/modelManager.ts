import {
	CreateMLCEngine,
	type InitProgressReport,
	type MLCEngine,
} from '@mlc-ai/web-llm';

export type ModelStatus = 'idle' | 'checking-webgpu' | 'loading' | 'ready' | 'generating' | 'error';

export interface LoadProgress {
	status: ModelStatus;
	text: string;
	progress?: number;
}

export class ModelManager {
	private engine: MLCEngine | null = null;
	private loadedModel = '';
	private status: ModelStatus = 'idle';
	private readonly maxContextTokens = 4096;
	private readonly reservedPromptTokens = 1200;
	private readonly chunkTargetChars = 9000;

	getStatus(): ModelStatus {
		return this.status;
	}

	async ensureLoaded(modelId: string, onProgress?: (progress: LoadProgress) => void): Promise<void> {
		if (this.engine && this.loadedModel === modelId) {
			onProgress?.({ status: 'ready', text: `Model ready: ${modelId}`, progress: 1 });
			return;
		}

		this.status = 'checking-webgpu';
		onProgress?.({ status: this.status, text: 'Checking WebGPU support...' });

		if (!('gpu' in navigator)) {
			this.status = 'error';
			throw new Error('WebGPU is not available in this Chrome profile.');
		}

		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			this.status = 'error';
			throw new Error('No WebGPU adapter is available.');
		}

		this.status = 'loading';
		onProgress?.({ status: this.status, text: `Loading model ${modelId}...` });

		this.engine = await CreateMLCEngine(modelId, {
			initProgressCallback: (report: InitProgressReport) => {
				onProgress?.({
					status: 'loading',
					text: report.text ?? `Loading ${modelId}...`,
					progress: report.progress,
				});
			},
		});

		this.loadedModel = modelId;
		this.status = 'ready';
		onProgress?.({ status: this.status, text: `Model ready: ${modelId}`, progress: 1 });
	}

	async reviewDiff(input: {
		modelId: string;
		prTitle: string;
		prDescription: string;
		diff: string;
	}, onToken: (token: string) => void): Promise<string> {
		if (!this.engine || this.loadedModel !== input.modelId) {
			throw new Error('The selected model is not loaded yet.');
		}

		this.status = 'generating';
		const promptChars = this.buildReviewPrompt(input.prTitle, input.prDescription, input.diff).length;
		const estimatedTokens = this.estimateTokens(promptChars);

		try {
			if (estimatedTokens <= this.getAvailablePromptTokens()) {
				const output = await this.streamSingleReview(
					input.modelId,
					input.prTitle,
					input.prDescription,
					input.diff,
					onToken,
				);
				this.status = 'ready';
				return output;
			}

			const chunkedOutput = await this.runChunkedReview(input, onToken);
			this.status = 'ready';
			return chunkedOutput;
		} catch (error) {
			this.status = 'error';
			throw error;
		}
	}

	private async streamSingleReview(
		modelId: string,
		prTitle: string,
		prDescription: string,
		diff: string,
		onToken: (token: string) => void,
	): Promise<string> {
		let output = '';
		const stream = await this.engine!.chat.completions.create({
			model: modelId,
			stream: true,
			temperature: 0.2,
			messages: [
				{
					role: 'system',
					content:
						'You are an expert software engineer reviewing pull requests. ' +
						'Respond in markdown with sections: Summary, Findings, Suggestions. ' +
						'If there are no significant issues, say so clearly.',
				},
				{
					role: 'user',
					content: this.buildReviewPrompt(prTitle, prDescription, diff),
				},
			],
		});

		for await (const chunk of stream) {
			const token = chunk.choices?.[0]?.delta?.content ?? '';
			if (!token) {
				continue;
			}
			output += token;
			onToken(token);
		}

		return output;
	}

	private async runChunkedReview(
		input: {
			modelId: string;
			prTitle: string;
			prDescription: string;
			diff: string;
		},
		onToken: (token: string) => void,
	): Promise<string> {
		const chunks = this.chunkDiff(input.diff);
		const partialReviews: string[] = [];

		onToken(
			`Diff is too large for this model in one pass, so running chunked review across ${chunks.length} part(s).\n\n`,
		);

		for (let i = 0; i < chunks.length; i += 1) {
			const chunk = chunks[i];
			onToken(`\n---\nReviewing chunk ${i + 1}/${chunks.length}\n\n`);

			const chunkReview = await this.generateChunkReview(
				input.modelId,
				input.prTitle,
				input.prDescription,
				chunk,
			);

			partialReviews.push(`Chunk ${i + 1} review:\n${chunkReview}`);
			onToken(chunkReview);
			onToken('\n');
		}

		onToken('\n---\nSynthesizing final review from chunk findings...\n\n');
		const finalReview = await this.generateFinalSynthesis(
			input.modelId,
			input.prTitle,
			input.prDescription,
			partialReviews,
		);
		onToken(finalReview);
		return finalReview;
	}

	private async generateChunkReview(
		modelId: string,
		prTitle: string,
		prDescription: string,
		diffChunk: string,
	): Promise<string> {
		const response = await this.engine!.chat.completions.create({
			model: modelId,
			stream: false,
			temperature: 0.2,
			messages: [
				{
					role: 'system',
					content:
						'You are an expert software engineer reviewing one chunk of a pull request diff. ' +
						'Focus only on the supplied chunk. Return concise markdown with Findings and Suggestions. ' +
						'If there are no significant issues, say so clearly.',
				},
				{
					role: 'user',
					content: [
						`PR Title: ${prTitle}`,
						`PR Description: ${prDescription || '(none)'}`,
						'',
						'Review this diff chunk:',
						'```diff',
						diffChunk,
						'```',
					].join('\n'),
				},
			],
		});

		return response.choices?.[0]?.message?.content ?? 'No findings returned for this chunk.';
	}

	private async generateFinalSynthesis(
		modelId: string,
		prTitle: string,
		prDescription: string,
		partialReviews: string[],
	): Promise<string> {
		const mergedReviews = this.chunkTextByLength(partialReviews.join('\n\n'), this.chunkTargetChars);
		let synthesized = '';

		for (let i = 0; i < mergedReviews.length; i += 1) {
			const response = await this.engine!.chat.completions.create({
				model: modelId,
				stream: false,
				temperature: 0.2,
				messages: [
					{
						role: 'system',
						content:
							'You are synthesizing chunk-level code review findings into a final concise pull request review. ' +
							'Return markdown with sections: Summary, Findings, Suggestions. Deduplicate repeated findings.',
					},
					{
						role: 'user',
						content: [
							`PR Title: ${prTitle}`,
							`PR Description: ${prDescription || '(none)'}`,
							'',
							'Synthesize these chunk reviews into one cohesive review:',
							mergedReviews[i],
						].join('\n'),
					},
				],
			});

			const text = response.choices?.[0]?.message?.content ?? '';
			synthesized = synthesized ? `${synthesized}\n\n${text}` : text;
		}

		if (mergedReviews.length === 1) {
			return synthesized || 'No final synthesis was produced.';
		}

		const finalPass = await this.engine!.chat.completions.create({
			model: modelId,
			stream: false,
			temperature: 0.2,
			messages: [
				{
					role: 'system',
					content:
						'You are refining a combined pull request review. Return one final markdown review with sections: Summary, Findings, Suggestions.',
				},
				{
					role: 'user',
					content: [
						`PR Title: ${prTitle}`,
						`PR Description: ${prDescription || '(none)'}`,
						'',
						'Refine and deduplicate this combined review:',
						synthesized,
					].join('\n'),
				},
			],
		});

		return finalPass.choices?.[0]?.message?.content ?? synthesized ?? 'No final synthesis was produced.';
	}

	private buildReviewPrompt(prTitle: string, prDescription: string, diff: string): string {
		return [
			`PR Title: ${prTitle}`,
			`PR Description: ${prDescription || '(none)'}`,
			'',
			'Review the following diff:',
			'```diff',
			diff,
			'```',
		].join('\n');
	}

	private estimateTokens(charCount: number): number {
		return Math.ceil(charCount / 4);
	}

	private getAvailablePromptTokens(): number {
		return this.maxContextTokens - this.reservedPromptTokens;
	}

	private chunkDiff(diff: string): string[] {
		const fileSections = diff
			.split(/^diff --git /m)
			.map((part, index) => index === 0 ? part.trim() : `diff --git ${part.trim()}`)
			.filter(Boolean);

		if (fileSections.length === 0) {
			return this.chunkTextByLength(diff, this.chunkTargetChars);
		}

		const chunks: string[] = [];
		let currentChunk = '';

		for (const section of fileSections) {
			if (!currentChunk) {
				currentChunk = section;
				continue;
			}

			if ((currentChunk.length + section.length + 2) <= this.chunkTargetChars) {
				currentChunk += `\n\n${section}`;
				continue;
			}

			chunks.push(currentChunk);
			currentChunk = section;
		}

		if (currentChunk) {
			chunks.push(currentChunk);
		}

		return chunks.flatMap(chunk => this.chunkTextByLength(chunk, this.chunkTargetChars));
	}

	private chunkTextByLength(text: string, maxChars: number): string[] {
		if (text.length <= maxChars) {
			return [text];
		}

		const chunks: string[] = [];
		let start = 0;
		while (start < text.length) {
			let end = Math.min(start + maxChars, text.length);
			if (end < text.length) {
				const nextBreak = text.lastIndexOf('\n', end);
				if (nextBreak > start + Math.floor(maxChars / 2)) {
					end = nextBreak;
				}
			}
			chunks.push(text.slice(start, end).trim());
			start = end;
		}

		return chunks.filter(Boolean);
	}
}
