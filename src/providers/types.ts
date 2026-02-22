import * as vscode from 'vscode';

export interface GenerateOptions {
	captureMetrics?: boolean;
}

export interface StreamOptions extends GenerateOptions {
	onChunk: (text: string) => void;
}

export interface ProviderRequestContext {
	config: vscode.WorkspaceConfiguration;
	model: string;
	endpoint: string;
	temperature: number;
}

export interface ModelProvider {
	readonly name: string;
	isMatch(model: string): boolean;
	isAvailable(): Promise<boolean>;
	supportsStreaming(): boolean;
	generate(prompt: string, context: ProviderRequestContext, options?: GenerateOptions): Promise<string>;
	/**
	 * Streaming contract:
	 * - Providers with native streaming should emit incremental chunks through `options.onChunk`.
	 * - Providers without native streaming may generate the full response then emit one chunk.
	 * - Errors are expected to bubble to the caller so UI layers can handle termination consistently.
	 */
	stream(prompt: string, context: ProviderRequestContext, options: StreamOptions): Promise<string>;
}
