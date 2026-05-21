import * as vscode from 'vscode';

const SETUP_COMPLETE_KEY = 'ollamaSetupGuideCompleted';
const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';

interface OllamaStatus {
	running: boolean;
	models: string[];
	error?: string;
}

interface CloudProviderSetupMessage {
	command: 'configureCloudProvider';
	provider: string;
	model: string;
	apiKey: string;
	endpoint?: string;
	openaiModel?: string;
}

interface WebviewMessage {
	command: string;
	model?: string;
	provider?: string;
	apiKey?: string;
	endpoint?: string;
	openaiModel?: string;
}

interface CloudProviderSetup {
	id: string;
	configModel: string;
	apiKeySetting: string;
	modelSetting?: string;
	endpointSetting?: string;
}

const CLOUD_PROVIDER_SETUP: Record<string, CloudProviderSetup> = {
	anthropic: {
		id: 'anthropic',
		configModel: '',
		apiKeySetting: 'claudeApiKey',
	},
	gemini: {
		id: 'gemini',
		configModel: '',
		apiKeySetting: 'geminiApiKey',
	},
	mistral: {
		id: 'mistral',
		configModel: '',
		apiKeySetting: 'mistralApiKey',
	},
	huggingface: {
		id: 'huggingface',
		configModel: 'huggingface',
		apiKeySetting: 'hfApiKey',
		modelSetting: 'hfModel',
	},
	v0: {
		id: 'v0',
		configModel: '',
		apiKeySetting: 'v0ApiKey',
	},
	glm: {
		id: 'glm',
		configModel: '',
		apiKeySetting: 'glmApiKey',
	},
	minimax: {
		id: 'minimax',
		configModel: '',
		apiKeySetting: 'minimaxApiKey',
	},
	openaiCompatible: {
		id: 'openaiCompatible',
		configModel: 'openai-compatible',
		apiKeySetting: 'openaiCompatible.apiKey',
		modelSetting: 'openaiCompatible.model',
		endpointSetting: 'openaiCompatible.endpoint',
	},
};

async function configureCloudProvider(msg: CloudProviderSetupMessage): Promise<string> {
	const provider = CLOUD_PROVIDER_SETUP[msg.provider];
	const apiKey = msg.apiKey?.trim();
	const selectedModel = msg.model?.trim();

	if (!provider) {
		throw new Error('Unknown cloud provider.');
	}
	if (!apiKey) {
		throw new Error('API token is required.');
	}

	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = provider.configModel || selectedModel;
	if (!model) {
		throw new Error('Model is required.');
	}

	await config.update('model', model, vscode.ConfigurationTarget.Global);
	await config.update(provider.apiKeySetting, apiKey, vscode.ConfigurationTarget.Global);

	if (provider.modelSetting) {
		const providerModel = provider.id === 'openaiCompatible' ? msg.openaiModel?.trim() : selectedModel;
		if (!providerModel) {
			throw new Error('Provider model is required.');
		}
		await config.update(provider.modelSetting, providerModel, vscode.ConfigurationTarget.Global);
	}

	if (provider.endpointSetting) {
		const endpoint = msg.endpoint?.trim();
		if (!endpoint) {
			throw new Error('Endpoint is required.');
		}
		if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
			throw new Error('Endpoint must start with http:// or https://.');
		}
		await config.update(provider.endpointSetting, endpoint, vscode.ConfigurationTarget.Global);
	}

	return model;
}

/**
 * Check if Ollama is reachable and list installed models.
 */
async function checkOllamaStatus(): Promise<OllamaStatus> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const endpoint = config.get<string>('endpoint', `${OLLAMA_DEFAULT_BASE}/api/generate`);
	const baseUrl = endpoint.replace(/\/api\/generate\/?$/, '').replace(/\/$/, '');

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3000);
		const resp = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
		clearTimeout(timeout);

		if (!resp.ok) {
			return { running: false, models: [], error: `HTTP ${resp.status}` };
		}

		const data = await resp.json() as { models?: Array<{ name: string }> };
		const models = (data.models || []).map(m => m.name);
		return { running: true, models };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { running: false, models: [], error: msg };
	}
}

/**
 * Pull an Ollama model with progress reporting.
 */
async function pullOllamaModel(modelName: string): Promise<boolean> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const endpoint = config.get<string>('endpoint', `${OLLAMA_DEFAULT_BASE}/api/generate`);
	const baseUrl = endpoint.replace(/\/api\/generate\/?$/, '').replace(/\/$/, '');

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Pulling model: ${modelName}`,
			cancellable: true,
		},
		async (progress: vscode.Progress<{ increment?: number; message?: string }>, token: vscode.CancellationToken) => {
			try {
				const controller = new AbortController();
				token.onCancellationRequested(() => controller.abort());

				const resp = await fetch(`${baseUrl}/api/pull`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: modelName, stream: true }),
					signal: controller.signal,
				});

				if (!resp.ok || !resp.body) {
					vscode.window.showErrorMessage(`Failed to pull model: HTTP ${resp.status}`);
					return false;
				}

				const reader = resp.body.getReader();
				const decoder = new TextDecoder();
				let lastPercent = 0;

				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }

					const text = decoder.decode(value, { stream: true });
					for (const line of text.split('\n').filter(Boolean)) {
						try {
							const json = JSON.parse(line) as {
								status?: string;
								completed?: number;
								total?: number;
								error?: string;
							};
							if (json.error) {
								vscode.window.showErrorMessage(`Pull failed: ${json.error}`);
								return false;
							}
							if (json.total && json.completed) {
								const pct = Math.round((json.completed / json.total) * 100);
								const increment = pct - lastPercent;
								if (increment > 0) {
									progress.report({ increment, message: `${json.status || 'downloading'} ${pct}%` });
									lastPercent = pct;
								}
							} else if (json.status) {
								progress.report({ message: json.status });
							}
						} catch {
							// ignore malformed JSON lines
						}
					}
				}

				vscode.window.showInformationMessage(`Model "${modelName}" pulled successfully.`);
				return true;
			} catch (err: unknown) {
				if (token.isCancellationRequested) {
					vscode.window.showInformationMessage('Model pull cancelled.');
					return false;
				}
				const msg = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`Failed to pull model: ${msg}`);
				return false;
			}
		},
	);
}

/**
 * Show the interactive setup guide webview.
 */
function showSetupGuidePanel(context: vscode.ExtensionContext, initialMode: 'local' | 'cloud' = 'local'): void {
	const panel = vscode.window.createWebviewPanel(
		'ollamaSetupGuide',
		'Ollama Code Review - Setup Guide',
		vscode.ViewColumn.One,
		{ enableScripts: true, retainContextWhenHidden: true },
	);

	panel.webview.html = getSetupGuideHtml(panel.webview, initialMode);

	panel.webview.onDidReceiveMessage(
		async (msg: WebviewMessage) => {
			switch (msg.command) {
				case 'checkOllama': {
					const status = await checkOllamaStatus();
					panel.webview.postMessage({ command: 'ollamaStatus', ...status });
					break;
				}
				case 'pullModel': {
					if (!msg.model) { return; }
					const success = await pullOllamaModel(msg.model);
					if (success) {
						const config = vscode.workspace.getConfiguration('ollama-code-review');
						await config.update('model', msg.model, vscode.ConfigurationTarget.Global);
						panel.webview.postMessage({ command: 'modelSelected', model: msg.model });
					}
					const status = await checkOllamaStatus();
					panel.webview.postMessage({ command: 'ollamaStatus', ...status });
					break;
				}
				case 'selectLocalModel': {
					if (!msg.model) { return; }
					const config = vscode.workspace.getConfiguration('ollama-code-review');
					await config.update('model', msg.model, vscode.ConfigurationTarget.Global);
					panel.webview.postMessage({ command: 'modelSelected', model: msg.model });
					break;
				}
				case 'configureCloudProvider': {
					try {
						const model = await configureCloudProvider(msg as CloudProviderSetupMessage);
						panel.webview.postMessage({
							command: 'cloudConfigured',
							model,
							provider: msg.provider,
						});
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : String(err);
						panel.webview.postMessage({ command: 'cloudConfigError', error: message });
					}
					break;
				}
				case 'finishSetup': {
					await context.globalState.update(SETUP_COMPLETE_KEY, true);
					panel.dispose();
					vscode.window.showInformationMessage(
						'Setup complete. Use the status bar or Command Palette to start reviewing code.',
					);
					break;
				}
				case 'openExternalUrl': {
					if (msg.model) {
						vscode.env.openExternal(vscode.Uri.parse(msg.model));
					}
					break;
				}
			}
		},
		undefined,
		context.subscriptions,
	);
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getSetupGuideHtml(webview: vscode.Webview, initialMode: 'local' | 'cloud'): string {
	const nonce = getNonce();
	return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Setup Guide</title>
<style>
	:root {
		--accent: var(--vscode-button-background, #0e639c);
		--accent-foreground: var(--vscode-button-foreground, #ffffff);
		--success: var(--vscode-terminal-ansiGreen, #4ec9b0);
		--warning: var(--vscode-editorWarning-foreground, #cca700);
		--danger: var(--vscode-errorForeground, #f85149);
		--border: var(--vscode-panel-border, #3c3c3c);
		--muted: var(--vscode-descriptionForeground, #9d9d9d);
		--surface: var(--vscode-sideBar-background, var(--vscode-editor-background));
		--surface-alt: var(--vscode-editorWidget-background, var(--vscode-editor-background));
	}
	* { box-sizing: border-box; }
	body {
		background: var(--vscode-editor-background);
		color: var(--vscode-foreground);
		font-family: var(--vscode-font-family, system-ui);
		line-height: 1.5;
		margin: 0;
		padding: 28px 32px 40px;
	}
	main {
		margin: 0 auto;
		max-width: 980px;
	}
	h1, h2, h3, p { margin-top: 0; }
	h1 {
		font-size: 28px;
		line-height: 1.2;
		margin-bottom: 8px;
	}
	h2 {
		font-size: 18px;
		line-height: 1.3;
		margin-bottom: 8px;
	}
	h3 {
		font-size: 14px;
		margin-bottom: 6px;
	}
	p { margin-bottom: 12px; }
	code {
		background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.16));
		border-radius: 3px;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 0.92em;
		padding: 1px 4px;
	}
	.eyebrow {
		color: var(--muted);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0;
		margin-bottom: 8px;
		text-transform: uppercase;
	}
	.subtitle {
		color: var(--muted);
		font-size: 15px;
		margin-bottom: 22px;
		max-width: 720px;
	}
	.value-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 24px;
	}
	.value-item {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--muted);
		font-size: 12px;
		padding: 8px 10px;
	}
	.value-item strong {
		color: var(--vscode-foreground);
		font-weight: 600;
	}
	.stepper {
		align-items: stretch;
		display: flex;
		gap: 8px;
		margin-bottom: 24px;
	}
	.step-indicator {
		align-items: center;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		display: flex;
		flex: 1;
		gap: 10px;
		min-height: 44px;
		padding: 8px 10px;
	}
	.step-indicator.active {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 36%, transparent);
	}
	.step-indicator.done {
		border-color: color-mix(in srgb, var(--success) 68%, var(--border));
	}
	.step-number {
		align-items: center;
		border: 1px solid currentColor;
		border-radius: 999px;
		color: var(--muted);
		display: inline-flex;
		flex: 0 0 22px;
		font-size: 12px;
		font-weight: 700;
		height: 22px;
		justify-content: center;
		width: 22px;
	}
	.step-indicator.active .step-number { color: var(--accent); }
	.step-indicator.done .step-number {
		background: var(--success);
		border-color: var(--success);
		color: var(--vscode-editor-background);
	}
	.step-label {
		font-size: 13px;
		font-weight: 600;
	}
	.panel { display: none; }
	.panel.visible { display: block; }
	.card,
	.path-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.card {
		margin-bottom: 16px;
		padding: 20px;
	}
	.path-grid {
		display: grid;
		gap: 14px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.path-card {
		align-items: flex-start;
		display: flex;
		flex-direction: column;
		min-height: 260px;
		padding: 20px;
	}
	.path-card.primary {
		border-color: color-mix(in srgb, var(--accent) 54%, var(--border));
	}
	.path-card p,
	.section-header p,
	.helper {
		color: var(--muted);
	}
	.path-card .btn-row { margin-top: auto; }
	.status {
		align-items: center;
		border: 1px solid transparent;
		border-radius: 999px;
		display: inline-flex;
		gap: 8px;
		font-size: 13px;
		font-weight: 500;
		margin: 2px 0 12px;
		padding: 5px 10px;
	}
	.status.ok {
		background: color-mix(in srgb, var(--success) 14%, transparent);
		border-color: color-mix(in srgb, var(--success) 45%, transparent);
		color: var(--success);
	}
	.status.err {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		border-color: color-mix(in srgb, var(--danger) 38%, transparent);
		color: var(--danger);
	}
	.status.warning {
		background: color-mix(in srgb, var(--warning) 14%, transparent);
		border-color: color-mix(in srgb, var(--warning) 40%, transparent);
		color: var(--warning);
	}
	.status.loading { color: var(--muted); }
	.dot {
		border-radius: 50%;
		height: 8px;
		width: 8px;
	}
	.dot.green { background: var(--success); }
	.dot.red { background: var(--danger); }
	.dot.yellow { background: var(--warning); }
	button {
		align-items: center;
		border: 1px solid transparent;
		border-radius: 4px;
		cursor: pointer;
		display: inline-flex;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		gap: 6px;
		justify-content: center;
		line-height: 1.3;
		min-height: 32px;
		padding: 6px 14px;
		transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
	}
	button:hover { opacity: 0.9; }
	button:focus-visible {
		outline: 1px solid var(--vscode-focusBorder, var(--accent));
		outline-offset: 2px;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
	.btn-primary {
		background: var(--accent);
		color: var(--accent-foreground);
	}
	.btn-secondary {
		background: var(--vscode-button-secondaryBackground);
		color: var(--vscode-button-secondaryForeground);
	}
	.btn-row {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 14px;
	}
	.helper {
		font-size: 12px;
		margin-bottom: 0;
	}
	.install-instructions {
		background: var(--surface-alt);
		border: 1px solid var(--border);
		border-radius: 6px;
		margin: 12px 0;
		overflow: hidden;
		width: 100%;
	}
	.platform-tabs {
		border-bottom: 1px solid var(--border);
		display: flex;
	}
	.platform-tabs button {
		background: transparent;
		border: 0;
		border-radius: 0;
		color: var(--muted);
		flex: 1;
		font-weight: 500;
		min-height: 34px;
	}
	.platform-tabs button.active {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		color: var(--vscode-foreground);
	}
	.code-block {
		background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.16));
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 13px;
		line-height: 1.45;
		padding: 12px 14px;
		user-select: all;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.section-header {
		align-items: flex-start;
		display: flex;
		gap: 16px;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	.section-header p { margin-bottom: 0; }
	.model-grid {
		display: grid;
		gap: 12px;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	}
	.model-card {
		align-items: flex-start;
		background: var(--vscode-editor-background);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--vscode-foreground);
		display: flex;
		flex-direction: column;
		min-height: 132px;
		padding: 14px;
		text-align: left;
		width: 100%;
	}
	.model-card:hover { border-color: var(--accent); }
	.model-card.installed {
		border-color: color-mix(in srgb, var(--success) 62%, var(--border));
	}
	.model-card.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.model-name {
		font-weight: 700;
		margin-bottom: 6px;
	}
	.model-desc {
		color: var(--muted);
		font-size: 12px;
		font-weight: 400;
		margin-bottom: 10px;
	}
	.tag-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: auto;
	}
	.model-tag {
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 7px;
	}
	.model-tag.ok {
		background: color-mix(in srgb, var(--success) 14%, transparent);
		border-color: color-mix(in srgb, var(--success) 42%, transparent);
		color: var(--success);
	}
	.model-tag.accent {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent) 42%, transparent);
		color: var(--vscode-foreground);
	}
	.model-tag.neutral { color: var(--muted); }
	.cloud-layout {
		display: grid;
		gap: 16px;
		grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1.2fr);
	}
	.provider-list {
		display: grid;
		gap: 8px;
	}
	.provider-option {
		align-items: flex-start;
		background: var(--vscode-editor-background);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--vscode-foreground);
		display: flex;
		flex-direction: column;
		min-height: 72px;
		padding: 12px;
		text-align: left;
		width: 100%;
	}
	.provider-option.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.provider-name {
		font-weight: 700;
		margin-bottom: 4px;
	}
	.provider-desc {
		color: var(--muted);
		font-size: 12px;
		font-weight: 400;
	}
	.form-grid {
		align-content: start;
		align-self: start;
		display: grid;
		gap: 12px;
	}
	.form-grid .btn-row {
		align-self: start;
		margin-top: 2px;
	}
	.form-grid .btn-row button {
		flex: 0 0 auto;
		min-height: 32px;
	}
	.field label {
		display: block;
		font-size: 12px;
		font-weight: 700;
		margin-bottom: 5px;
	}
	.field input,
	.field select {
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, var(--border));
		border-radius: 4px;
		color: var(--vscode-input-foreground);
		font-family: inherit;
		font-size: 13px;
		min-height: 32px;
		padding: 6px 8px;
		width: 100%;
	}
	.field input:focus,
	.field select:focus {
		border-color: var(--vscode-focusBorder, var(--accent));
		outline: none;
	}
	.form-error {
		color: var(--danger);
		font-size: 12px;
		margin: 0;
	}
	.token-help {
		color: var(--muted);
		font-size: 12px;
		margin: 0;
	}
	.token-help button {
		background: transparent;
		color: var(--vscode-textLink-foreground);
		font-weight: 500;
		min-height: auto;
		padding: 0;
	}
	.ready-layout {
		display: grid;
		gap: 16px;
		grid-template-columns: minmax(0, 1.1fr) minmax(260px, 0.9fr);
	}
	.check-list {
		list-style: none;
		margin: 16px 0 0;
		padding: 0;
	}
	.check-list li {
		border-top: 1px solid var(--border);
		padding: 12px 0;
	}
	.check-list li:first-child { border-top: 0; }
	.check-list strong {
		display: block;
		margin-bottom: 3px;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.spinner {
		animation: spin 0.8s linear infinite;
		border: 2px solid var(--border);
		border-radius: 50%;
		border-top-color: var(--accent);
		display: inline-block;
		height: 14px;
		width: 14px;
	}
	.hidden { display: none; }
	.mt-16 { margin-top: 16px; }
	@media (max-width: 720px) {
		body { padding: 20px; }
		.stepper { flex-direction: column; }
		.path-grid,
		.cloud-layout,
		.ready-layout { grid-template-columns: 1fr; }
		.section-header { flex-direction: column; }
	}
</style>
</head>
<body>
	<main>
		<div class="eyebrow">First run setup</div>
		<h1>Review code with the model that fits your workflow</h1>
		<p class="subtitle">Choose a private local setup with Ollama or connect a cloud provider. The guide checks what is ready, then gets you to your first review without hunting through settings.</p>

		<div class="value-strip" aria-label="Setup benefits">
			<div class="value-item"><strong>Local:</strong> code stays on this machine</div>
			<div class="value-item"><strong>Cloud:</strong> no model download required</div>
			<div class="value-item"><strong>Later:</strong> switch models from the status bar</div>
		</div>

		<div class="stepper" aria-label="Setup progress">
			<div class="step-indicator active" id="si-1">
				<div class="step-number">1</div>
				<div class="step-label">Connect provider</div>
			</div>
			<div class="step-indicator" id="si-2">
				<div class="step-number">2</div>
				<div class="step-label">Choose model</div>
			</div>
			<div class="step-indicator" id="si-3">
				<div class="step-number">3</div>
				<div class="step-label">Run first review</div>
			</div>
		</div>

		<div class="panel visible" id="panel-1">
			<div class="path-grid">
				<section class="path-card primary" aria-labelledby="local-title">
					<h2 id="local-title">Use local Ollama</h2>
					<p>Best for private repositories, offline work, and teams that want review data to stay on the developer machine.</p>

					<div id="ollama-status">
						<span class="status loading"><span class="spinner"></span> Checking Ollama...</span>
					</div>

					<div id="ollama-found" class="hidden">
						<p class="helper" id="model-count-msg"></p>
					</div>

					<div id="ollama-not-found" class="hidden">
						<p class="helper">Install Ollama, start it, then re-check the connection.</p>
						<div class="install-instructions">
							<div class="platform-tabs" role="tablist" aria-label="Install commands">
								<button type="button" class="active" data-platform="mac" role="tab" aria-selected="true">macOS</button>
								<button type="button" data-platform="linux" role="tab" aria-selected="false">Linux</button>
								<button type="button" data-platform="windows" role="tab" aria-selected="false">Windows</button>
							</div>
							<div class="code-block" id="platform-mac">brew install ollama
ollama serve</div>
							<div class="code-block hidden" id="platform-linux">curl -fsSL https://ollama.com/install.sh | sh
ollama serve</div>
							<div class="code-block hidden" id="platform-windows">Download Ollama, launch it from the Start menu, then return here.</div>
						</div>
					</div>

					<div class="btn-row">
						<button type="button" class="btn-primary" id="continue-local-btn" disabled>Continue with Ollama</button>
						<button type="button" class="btn-secondary" id="download-ollama-btn">Download</button>
						<button type="button" class="btn-secondary" id="check-ollama-btn">Re-check</button>
					</div>
				</section>

				<section class="path-card" aria-labelledby="cloud-title">
					<h2 id="cloud-title">Use a cloud model</h2>
					<p>Best when you need setup to be quick, you already have a provider key, or local model downloads are too large for this machine.</p>
					<span class="status warning"><span class="dot yellow"></span> API key may be required</span>
					<p class="helper">You can choose Gemini, Claude, Mistral, OpenAI-compatible endpoints, and other configured providers from the model picker.</p>
					<div class="btn-row">
						<button type="button" class="btn-secondary" id="cloud-model-btn">Choose cloud model</button>
					</div>
				</section>
			</div>
		</div>

		<div class="panel" id="panel-2">
			<section class="card" id="local-model-section" aria-labelledby="model-title">
				<div class="section-header">
					<div>
						<h2 id="model-title">Choose a local model</h2>
						<p>Start with the recommended coding model unless you already know this machine can run a larger one.</p>
					</div>
					<div id="model-status">
						<span class="status loading"><span class="spinner"></span> Loading models...</span>
					</div>
				</div>

				<div class="model-grid" id="model-grid" aria-live="polite"></div>

				<div id="pull-status" class="hidden mt-16" aria-live="polite">
					<span class="status loading"><span class="spinner"></span> <span id="pull-msg">Pulling model...</span></span>
				</div>

				<div class="btn-row">
					<button type="button" class="btn-secondary" id="back-to-provider-btn">Back</button>
					<button type="button" class="btn-primary" id="btn-next-2" disabled>Continue</button>
				</div>
			</section>

			<section class="card hidden" id="cloud-setup-section" aria-labelledby="cloud-setup-title">
				<div class="section-header">
					<div>
						<h2 id="cloud-setup-title">Choose a cloud provider</h2>
						<p>Select a provider, pick one of its supported models, then enter the API token for that account.</p>
					</div>
					<div id="cloud-status">
						<span class="status warning"><span class="dot yellow"></span> Token saved to settings</span>
					</div>
				</div>

				<div class="cloud-layout">
					<div class="provider-list" id="provider-list" aria-label="Cloud providers"></div>
					<div class="form-grid">
						<div class="field">
							<label for="cloud-model-select">Model</label>
							<select id="cloud-model-select"></select>
						</div>
						<div class="field hidden" id="openai-endpoint-field">
							<label for="openai-endpoint-input">Endpoint</label>
							<input id="openai-endpoint-input" type="url" placeholder="https://api.openai.com/v1">
						</div>
						<div class="field hidden" id="openai-model-field">
							<label for="openai-model-input">OpenAI-compatible model name</label>
							<input id="openai-model-input" type="text" placeholder="gpt-4o-mini">
						</div>
						<div class="field">
							<label for="cloud-api-key-input" id="cloud-api-key-label">API token</label>
							<input id="cloud-api-key-input" type="password" autocomplete="off" placeholder="Paste API token">
							<p class="token-help" id="cloud-token-help"></p>
						</div>
						<p class="form-error hidden" id="cloud-form-error" aria-live="polite"></p>
						<div class="btn-row">
							<button type="button" class="btn-secondary" id="back-from-cloud-btn">Back</button>
							<button type="button" class="btn-primary" id="save-cloud-btn">Save cloud setup</button>
						</div>
					</div>
				</div>
			</section>
		</div>

		<div class="panel" id="panel-3">
			<section class="card" aria-labelledby="ready-title">
				<div class="ready-layout">
					<div>
						<h2 id="ready-title">You are ready to review code</h2>
						<p id="ready-summary">Your model is configured. Here are the fastest ways to use it.</p>
						<ul class="check-list">
							<li><strong>Review staged changes</strong>Stage a Git diff, then run <code>Ollama: Review Staged Changes</code>.</li>
							<li><strong>Generate a commit message</strong>Stage changes, then run <code>Ollama: Generate Commit Message</code>.</li>
							<li><strong>Use inline actions</strong>Select code and open the lightbulb menu for explain, fix, tests, or docs.</li>
						</ul>
					</div>
					<div>
						<h3>Good to know</h3>
						<p class="helper">The selected model is shown in the VS Code status bar. Use it anytime to switch providers or models without reopening this guide.</p>
						<div class="btn-row">
							<button type="button" class="btn-primary" id="finish-btn">Start reviewing</button>
							<button type="button" class="btn-secondary" id="back-to-model-btn">Back</button>
						</div>
					</div>
				</div>
			</section>
		</div>
	</main>

<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	let currentStep = 1;
	let ollamaRunning = false;
	let installedModels = [];
	let selectedModel = '';
	let selectedProviderName = '';
	let setupMode = '${initialMode}';
	let isPulling = false;

	const RECOMMENDED_MODELS = [
		{ name: 'qwen2.5-coder:7b', desc: 'Fast code reviews on most developer laptops.', size: '4.7 GB', recommended: true },
		{ name: 'qwen2.5-coder:14b', desc: 'Higher quality if you have more memory available.', size: '9 GB', recommended: false },
		{ name: 'deepseek-coder-v2:16b', desc: 'Strong coding model for larger local setups.', size: '8.9 GB', recommended: false },
		{ name: 'codellama:7b', desc: 'Lightweight code-focused fallback.', size: '3.8 GB', recommended: false },
		{ name: 'llama3.1:8b', desc: 'General-purpose model that also handles reviews.', size: '4.7 GB', recommended: false },
		{ name: 'mistral:7b', desc: 'Fast general-purpose option for smaller machines.', size: '4.1 GB', recommended: false },
	];

	const CLOUD_PROVIDERS = [
		{
			id: 'anthropic',
			name: 'Anthropic Claude',
			desc: 'Strong reasoning and code review quality.',
			apiKeyLabel: 'Anthropic API key',
			tokenUrl: 'https://console.anthropic.com/settings/keys',
			models: [
				{ id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
				{ id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
				{ id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
			],
		},
		{
			id: 'gemini',
			name: 'Google Gemini',
			desc: 'Fast Google AI models with large context.',
			apiKeyLabel: 'Google AI Studio API key',
			tokenUrl: 'https://aistudio.google.com/app/apikey',
			models: [
				{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
				{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
			],
		},
		{
			id: 'mistral',
			name: 'Mistral',
			desc: 'European-hosted models and Codestral for code.',
			apiKeyLabel: 'Mistral API key',
			tokenUrl: 'https://console.mistral.ai/api-keys',
			models: [
				{ id: 'codestral-latest', label: 'Codestral' },
				{ id: 'mistral-large-latest', label: 'Mistral Large' },
				{ id: 'mistral-small-latest', label: 'Mistral Small' },
			],
		},
		{
			id: 'huggingface',
			name: 'Hugging Face',
			desc: 'Inference API with selectable open models.',
			apiKeyLabel: 'Hugging Face token',
			tokenUrl: 'https://huggingface.co/settings/tokens',
			models: [
				{ id: 'Qwen/Qwen2.5-Coder-7B-Instruct', label: 'Qwen2.5 Coder 7B' },
				{ id: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen2.5 Coder 32B' },
				{ id: 'mistralai/Mistral-7B-Instruct-v0.3', label: 'Mistral 7B Instruct' },
				{ id: 'codellama/CodeLlama-7b-Instruct-hf', label: 'CodeLlama 7B Instruct' },
			],
		},
		{
			id: 'v0',
			name: 'v0',
			desc: 'Vercel coding models optimized for developer work.',
			apiKeyLabel: 'v0 API key',
			tokenUrl: 'https://v0.dev/chat/settings/keys',
			models: [
				{ id: 'v0-auto', label: 'v0 Auto' },
				{ id: 'v0-mini', label: 'v0 Mini' },
				{ id: 'v0-pro', label: 'v0 Pro' },
				{ id: 'v0-max', label: 'v0 Max' },
				{ id: 'v0-max-fast', label: 'v0 Max Fast' },
			],
		},
		{
			id: 'glm',
			name: 'Z.AI / GLM',
			desc: 'GLM models via Z.AI or BigModel API.',
			apiKeyLabel: 'Z.AI API key',
			tokenUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
			models: [
				{ id: 'glm-4.7-flash', label: 'GLM 4.7 Flash' },
			],
		},
		{
			id: 'minimax',
			name: 'MiniMax',
			desc: 'MiniMax models for cloud code review.',
			apiKeyLabel: 'MiniMax API key',
			tokenUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
			models: [
				{ id: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
			],
		},
		{
			id: 'openaiCompatible',
			name: 'OpenAI-compatible',
			desc: 'Groq, OpenRouter, Together AI, or a custom /v1 endpoint.',
			apiKeyLabel: 'Endpoint API key',
			tokenUrl: 'https://openrouter.ai/settings/keys',
			defaultEndpoint: 'https://openrouter.ai/api/v1',
			defaultOpenaiModel: 'openai/gpt-4o-mini',
			models: [
				{ id: 'openai-compatible', label: 'OpenAI-compatible endpoint' },
			],
		},
	];

	function goToStep(step) {
		currentStep = step;
		for (let i = 1; i <= 3; i++) {
			const si = document.getElementById('si-' + i);
			si.classList.remove('active', 'done');
			if (i < step) si.classList.add('done');
			if (i === step) si.classList.add('active');
		}
		document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
		const target = document.getElementById('panel-' + step);
		if (target) target.classList.add('visible');
		if (step === 2) {
			if (setupMode === 'cloud') {
				renderCloudSetup();
			} else {
				renderModelGrid();
			}
		}
		if (step === 3) updateReadySummary();
	}

	function showSecondStepMode() {
		document.getElementById('local-model-section').classList.toggle('hidden', setupMode !== 'local');
		document.getElementById('cloud-setup-section').classList.toggle('hidden', setupMode !== 'cloud');
	}

	function renderModelGrid() {
		showSecondStepMode();
		const grid = document.getElementById('model-grid');
		grid.innerHTML = '';
		const names = new Set(RECOMMENDED_MODELS.map(m => m.name));
		const installedExtras = installedModels
			.filter(name => !names.has(name))
			.map(name => ({ name, desc: 'Installed locally in Ollama.', size: 'Local', recommended: false }));
		const models = RECOMMENDED_MODELS.concat(installedExtras);

		models.forEach(m => {
			const isInstalled = installedModels.includes(m.name);
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'model-card' + (isInstalled ? ' installed' : '') + (selectedModel === m.name ? ' selected' : '');
			button.disabled = isPulling;
			button.setAttribute('aria-pressed', selectedModel === m.name ? 'true' : 'false');
			button.innerHTML =
				'<span class="model-name">' + esc(m.name) + '</span>' +
				'<span class="model-desc">' + esc(m.desc) + '</span>' +
				'<span class="tag-row">' +
				(m.recommended ? '<span class="model-tag accent">Recommended</span>' : '') +
				'<span class="model-tag neutral">' + esc(m.size) + '</span>' +
				(isInstalled ? '<span class="model-tag ok">Installed</span>' : '<span class="model-tag neutral">Download</span>') +
				'</span>';
			button.addEventListener('click', () => onModelClick(m.name, isInstalled));
			grid.appendChild(button);
		});
		updateNextButton();
		updateModelStatus();
	}

	function renderCloudSetup() {
		showSecondStepMode();
		const provider = getSelectedProvider();
		const list = document.getElementById('provider-list');
		const modelSelect = document.getElementById('cloud-model-select');
		const tokenInput = document.getElementById('cloud-api-key-input');
		const tokenHelp = document.getElementById('cloud-token-help');
		const tokenLabel = document.getElementById('cloud-api-key-label');
		const endpointField = document.getElementById('openai-endpoint-field');
		const endpointInput = document.getElementById('openai-endpoint-input');
		const openaiModelField = document.getElementById('openai-model-field');
		const openaiModelInput = document.getElementById('openai-model-input');

		list.innerHTML = '';
		CLOUD_PROVIDERS.forEach(p => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'provider-option' + (provider.id === p.id ? ' selected' : '');
			button.setAttribute('aria-pressed', provider.id === p.id ? 'true' : 'false');
			button.innerHTML =
				'<span class="provider-name">' + esc(p.name) + '</span>' +
				'<span class="provider-desc">' + esc(p.desc) + '</span>';
			button.addEventListener('click', () => {
				selectedProviderName = p.id;
				renderCloudSetup();
			});
			list.appendChild(button);
		});

		modelSelect.innerHTML = '';
		provider.models.forEach(model => {
			const option = document.createElement('option');
			option.value = model.id;
			option.textContent = model.label;
			modelSelect.appendChild(option);
		});

		tokenLabel.textContent = provider.apiKeyLabel;
		tokenInput.placeholder = 'Paste ' + provider.apiKeyLabel;
		tokenHelp.innerHTML = '';
		tokenHelp.append('Need a token? ');
		const linkButton = document.createElement('button');
		linkButton.type = 'button';
		linkButton.textContent = 'Open provider key page';
		linkButton.addEventListener('click', () => openUrl(provider.tokenUrl));
		tokenHelp.appendChild(linkButton);

		const usesOpenAICompatible = provider.id === 'openaiCompatible';
		endpointField.classList.toggle('hidden', !usesOpenAICompatible);
		openaiModelField.classList.toggle('hidden', !usesOpenAICompatible);
		if (usesOpenAICompatible) {
			endpointInput.value = endpointInput.value || provider.defaultEndpoint || '';
			openaiModelInput.value = openaiModelInput.value || provider.defaultOpenaiModel || '';
		}

		clearCloudError();
	}

	function onModelClick(model, isInstalled) {
		if (isPulling) return;
		if (isInstalled) {
			selectedModel = model;
			vscode.postMessage({ command: 'selectLocalModel', model: model });
			renderModelGrid();
			return;
		}
		selectedModel = model;
		isPulling = true;
		document.getElementById('pull-status').classList.remove('hidden');
		document.getElementById('pull-msg').textContent = 'Downloading ' + model + '. Progress appears in the VS Code notification.';
		renderModelGrid();
		vscode.postMessage({ command: 'pullModel', model: model });
	}

	function updateNextButton() {
		document.getElementById('btn-next-2').disabled = !selectedModel || isPulling;
	}

	function updateModelStatus() {
		const status = document.getElementById('model-status');
		if (!ollamaRunning) {
			status.innerHTML = '<span class="status err"><span class="dot red"></span> Ollama not connected</span>';
			return;
		}
		if (selectedModel) {
			status.innerHTML = '<span class="status ok"><span class="dot green"></span> ' + esc(selectedModel) + ' selected</span>';
			return;
		}
		status.innerHTML = installedModels.length > 0
			? '<span class="status ok"><span class="dot green"></span> ' + installedModels.length + ' local model' + (installedModels.length > 1 ? 's' : '') + ' available</span>'
			: '<span class="status warning"><span class="dot yellow"></span> No local models installed</span>';
	}

	function checkOllama() {
		document.getElementById('ollama-status').innerHTML =
			'<span class="status loading"><span class="spinner"></span> Checking Ollama...</span>';
		document.getElementById('ollama-not-found').classList.add('hidden');
		document.getElementById('ollama-found').classList.add('hidden');
		vscode.postMessage({ command: 'checkOllama' });
	}

	function showPlatform(platform, button) {
		['mac', 'linux', 'windows'].forEach(p => {
			document.getElementById('platform-' + p).classList.toggle('hidden', p !== platform);
		});
		document.querySelectorAll('.platform-tabs button').forEach(b => {
			b.classList.toggle('active', b === button);
			b.setAttribute('aria-selected', b === button ? 'true' : 'false');
		});
	}

	function chooseCloudModel() {
		selectedModel = '';
		setupMode = 'cloud';
		goToStep(2);
	}

	function getSelectedProvider() {
		if (!selectedProviderName) {
			selectedProviderName = CLOUD_PROVIDERS[0].id;
		}
		return CLOUD_PROVIDERS.find(provider => provider.id === selectedProviderName) || CLOUD_PROVIDERS[0];
	}

	function clearCloudError() {
		const error = document.getElementById('cloud-form-error');
		error.textContent = '';
		error.classList.add('hidden');
	}

	function showCloudError(message) {
		const error = document.getElementById('cloud-form-error');
		error.textContent = message;
		error.classList.remove('hidden');
	}

	function saveCloudSetup() {
		const provider = getSelectedProvider();
		const model = document.getElementById('cloud-model-select').value;
		const apiKey = document.getElementById('cloud-api-key-input').value.trim();
		const endpoint = document.getElementById('openai-endpoint-input').value.trim();
		const openaiModel = document.getElementById('openai-model-input').value.trim();

		clearCloudError();
		if (!apiKey) {
			showCloudError('Enter an API token before saving.');
			return;
		}
		if (provider.id === 'openaiCompatible') {
			if (!endpoint) {
				showCloudError('Enter the OpenAI-compatible endpoint.');
				return;
			}
			if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
				showCloudError('Endpoint must start with http:// or https://.');
				return;
			}
			if (!openaiModel) {
				showCloudError('Enter the model name for the endpoint.');
				return;
			}
		}

		document.getElementById('save-cloud-btn').disabled = true;
		document.getElementById('cloud-status').innerHTML =
			'<span class="status loading"><span class="spinner"></span> Saving setup...</span>';
		vscode.postMessage({
			command: 'configureCloudProvider',
			provider: provider.id,
			model,
			apiKey,
			endpoint,
			openaiModel,
		});
	}

	function openUrl(url) {
		vscode.postMessage({ command: 'openExternalUrl', model: url });
	}

	function finish() {
		vscode.postMessage({ command: 'finishSetup' });
	}

	function updateReadySummary() {
		const summary = document.getElementById('ready-summary');
		if (setupMode === 'cloud' && selectedProviderName) {
			const provider = getSelectedProvider();
			summary.textContent = provider.name + ' reviews will use ' + selectedModel + '.';
		} else if (selectedModel) {
			summary.textContent = 'Local reviews will use ' + selectedModel + '.';
		} else {
			summary.textContent = 'Your provider selection is handled by the model picker.';
		}
	}

	function esc(s) {
		const d = document.createElement('div');
		d.textContent = s;
		return d.innerHTML;
	}

	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg.command === 'ollamaStatus') {
			ollamaRunning = msg.running;
			installedModels = msg.models || [];

			if (msg.running) {
				const count = installedModels.length;
				document.getElementById('ollama-status').innerHTML =
					'<span class="status ok"><span class="dot green"></span> Ollama is running</span>';
				document.getElementById('model-count-msg').textContent =
					count > 0
						? count + ' model' + (count > 1 ? 's' : '') + ' installed locally.'
						: 'No models installed yet. The next step can download one for you.';
				document.getElementById('ollama-found').classList.remove('hidden');
				document.getElementById('ollama-not-found').classList.add('hidden');
				document.getElementById('continue-local-btn').disabled = false;
			} else {
				document.getElementById('ollama-status').innerHTML =
					'<span class="status err"><span class="dot red"></span> Ollama not detected</span>';
				document.getElementById('ollama-not-found').classList.remove('hidden');
				document.getElementById('ollama-found').classList.add('hidden');
				document.getElementById('continue-local-btn').disabled = true;
			}

			isPulling = false;
			document.getElementById('pull-status').classList.add('hidden');
			if (currentStep === 2 && setupMode === 'local') renderModelGrid();
		}

		if (msg.command === 'modelSelected') {
			selectedModel = msg.model || selectedModel;
			isPulling = false;
			document.getElementById('pull-status').classList.add('hidden');
			if (setupMode === 'local') renderModelGrid();
			goToStep(3);
		}

		if (msg.command === 'cloudConfigured') {
			selectedModel = msg.model || selectedModel;
			selectedProviderName = msg.provider || selectedProviderName;
			document.getElementById('save-cloud-btn').disabled = false;
			document.getElementById('cloud-status').innerHTML =
				'<span class="status ok"><span class="dot green"></span> Cloud provider saved</span>';
			goToStep(3);
		}

		if (msg.command === 'cloudConfigError') {
			document.getElementById('save-cloud-btn').disabled = false;
			document.getElementById('cloud-status').innerHTML =
				'<span class="status err"><span class="dot red"></span> Setup failed</span>';
			showCloudError(msg.error || 'Could not save cloud setup.');
		}
	});

	document.getElementById('continue-local-btn').addEventListener('click', () => {
		setupMode = 'local';
		goToStep(2);
	});
	document.getElementById('download-ollama-btn').addEventListener('click', () => openUrl('https://ollama.com/download'));
	document.getElementById('check-ollama-btn').addEventListener('click', checkOllama);
	document.getElementById('cloud-model-btn').addEventListener('click', chooseCloudModel);
	document.getElementById('back-to-provider-btn').addEventListener('click', () => goToStep(1));
	document.getElementById('back-from-cloud-btn').addEventListener('click', () => goToStep(1));
	document.getElementById('btn-next-2').addEventListener('click', () => goToStep(3));
	document.getElementById('save-cloud-btn').addEventListener('click', saveCloudSetup);
	document.getElementById('finish-btn').addEventListener('click', finish);
	document.getElementById('back-to-model-btn').addEventListener('click', () => selectedModel ? goToStep(2) : goToStep(1));
	document.querySelectorAll('.platform-tabs button').forEach(button => {
		button.addEventListener('click', () => showPlatform(button.dataset.platform, button));
	});

	checkOllama();
	if (setupMode === 'cloud') {
		goToStep(2);
	}
</script>
</body>
</html>`;
}

/**
 * Check if this is the first activation and show the setup guide.
 * Called from activate() in commands/index.ts.
 */
export async function maybeShowSetupGuide(context: vscode.ExtensionContext): Promise<void> {
	const alreadyCompleted = context.globalState.get<boolean>(SETUP_COMPLETE_KEY, false);
	if (alreadyCompleted) {
		return;
	}

	const choice = await vscode.window.showInformationMessage(
		'Welcome to Ollama Code Review. Set up a local Ollama model or choose a cloud provider now?',
		'Open Setup Guide',
		'Choose Cloud Model',
		'Skip Setup',
	);

	if (choice === 'Open Setup Guide') {
		showSetupGuidePanel(context);
	} else if (choice === 'Choose Cloud Model') {
		showSetupGuidePanel(context, 'cloud');
	} else if (choice === 'Skip Setup') {
		await context.globalState.update(SETUP_COMPLETE_KEY, true);
	}
}

/**
 * Show the setup guide on demand (from command palette).
 */
export function showSetupGuide(context: vscode.ExtensionContext): void {
	showSetupGuidePanel(context);
}
