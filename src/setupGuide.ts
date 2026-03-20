import * as vscode from 'vscode';

const SETUP_COMPLETE_KEY = 'ollamaSetupGuideCompleted';
const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';

interface OllamaStatus {
	running: boolean;
	models: string[];
	error?: string;
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
function showSetupGuidePanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'ollamaSetupGuide',
		'Ollama Code Review — Setup Guide',
		vscode.ViewColumn.One,
		{ enableScripts: true, retainContextWhenHidden: true },
	);

	panel.webview.html = getSetupGuideHtml();

	panel.webview.onDidReceiveMessage(
		async (msg: { command: string; model?: string }) => {
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
					}
					// Re-check status after pull
					const status = await checkOllamaStatus();
					panel.webview.postMessage({ command: 'ollamaStatus', ...status });
					break;
				}
				case 'selectCloudModel': {
					await vscode.commands.executeCommand('ollama-code-review.selectModel');
					break;
				}
				case 'finishSetup': {
					await context.globalState.update(SETUP_COMPLETE_KEY, true);
					panel.dispose();
					vscode.window.showInformationMessage(
						'Setup complete! Use the status bar or Command Palette to start reviewing code.',
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

function getSetupGuideHtml(): string {
	return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Setup Guide</title>
<style>
	:root {
		--step-active: var(--vscode-focusBorder, #007acc);
		--step-done: var(--vscode-terminal-ansiGreen, #4ec9b0);
		--step-pending: var(--vscode-disabledForeground, #888);
		--card-bg: var(--vscode-editor-background);
		--card-border: var(--vscode-panel-border, #333);
	}
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body {
		font-family: var(--vscode-font-family, system-ui);
		color: var(--vscode-foreground);
		background: var(--vscode-editor-background);
		padding: 24px 32px;
		line-height: 1.6;
	}
	h1 { font-size: 1.6em; margin-bottom: 4px; }
	.subtitle { opacity: 0.7; margin-bottom: 24px; }

	/* Stepper */
	.stepper {
		display: flex;
		gap: 0;
		margin-bottom: 32px;
		position: relative;
	}
	.step-indicator {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1;
		position: relative;
		cursor: default;
	}
	.step-circle {
		width: 32px; height: 32px;
		border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		font-weight: bold; font-size: 14px;
		border: 2px solid var(--step-pending);
		color: var(--step-pending);
		background: var(--card-bg);
		z-index: 1;
		transition: all 0.3s;
	}
	.step-indicator.active .step-circle {
		border-color: var(--step-active);
		color: var(--step-active);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--step-active) 25%, transparent);
	}
	.step-indicator.done .step-circle {
		border-color: var(--step-done);
		background: var(--step-done);
		color: var(--card-bg);
	}
	.step-label {
		margin-top: 8px;
		font-size: 12px;
		opacity: 0.6;
		text-align: center;
	}
	.step-indicator.active .step-label { opacity: 1; font-weight: 600; }
	.step-indicator.done .step-label { opacity: 0.8; }
	/* connector line */
	.step-indicator:not(:last-child)::after {
		content: '';
		position: absolute;
		top: 16px;
		left: calc(50% + 20px);
		width: calc(100% - 40px);
		height: 2px;
		background: var(--step-pending);
		z-index: 0;
	}
	.step-indicator.done:not(:last-child)::after {
		background: var(--step-done);
	}

	/* Panels */
	.panel { display: none; }
	.panel.visible { display: block; }
	.card {
		background: var(--vscode-sideBar-background, var(--card-bg));
		border: 1px solid var(--card-border);
		border-radius: 8px;
		padding: 20px 24px;
		margin-bottom: 16px;
	}
	.card h2 { font-size: 1.2em; margin-bottom: 8px; }
	.card p { margin-bottom: 12px; }

	/* Status badge */
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px;
		border-radius: 12px;
		font-size: 13px;
		font-weight: 500;
	}
	.status.ok { background: color-mix(in srgb, var(--step-done) 20%, transparent); color: var(--step-done); }
	.status.err { background: color-mix(in srgb, var(--vscode-errorForeground, red) 15%, transparent); color: var(--vscode-errorForeground, #f44); }
	.status.loading { opacity: 0.7; }
	.dot { width: 8px; height: 8px; border-radius: 50%; }
	.dot.green { background: var(--step-done); }
	.dot.red { background: var(--vscode-errorForeground, #f44); }

	/* Buttons */
	button {
		font-family: inherit;
		font-size: 13px;
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	button:hover { opacity: 0.85; }
	button:disabled { opacity: 0.4; cursor: not-allowed; }
	.btn-primary {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	.btn-secondary {
		background: var(--vscode-button-secondaryBackground);
		color: var(--vscode-button-secondaryForeground);
	}
	.btn-link {
		background: transparent;
		color: var(--vscode-textLink-foreground);
		text-decoration: underline;
		padding: 4px 0;
	}
	.btn-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }

	/* Model cards */
	.model-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
		margin-top: 12px;
	}
	.model-card {
		border: 1px solid var(--card-border);
		border-radius: 6px;
		padding: 14px;
		cursor: pointer;
		transition: border-color 0.2s, box-shadow 0.2s;
	}
	.model-card:hover {
		border-color: var(--step-active);
		box-shadow: 0 0 0 1px var(--step-active);
	}
	.model-card.installed {
		border-color: var(--step-done);
	}
	.model-card .model-name { font-weight: 600; margin-bottom: 4px; }
	.model-card .model-desc { font-size: 12px; opacity: 0.7; }
	.model-card .model-tag {
		display: inline-block;
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 3px;
		margin-top: 6px;
		background: color-mix(in srgb, var(--step-done) 20%, transparent);
		color: var(--step-done);
	}

	/* Install instructions */
	.install-instructions {
		margin-top: 8px;
	}
	.install-instructions .platform-tabs {
		display: flex;
		gap: 0;
		margin-bottom: 12px;
	}
	.platform-tabs button {
		border-radius: 4px 4px 0 0;
		border: 1px solid var(--card-border);
		border-bottom: none;
		padding: 6px 16px;
		font-size: 13px;
		background: transparent;
		color: var(--vscode-foreground);
		opacity: 0.6;
	}
	.platform-tabs button.active {
		opacity: 1;
		background: var(--vscode-sideBar-background, var(--card-bg));
		font-weight: 600;
	}
	.code-block {
		background: var(--vscode-textCodeBlock-background, #1e1e1e);
		border: 1px solid var(--card-border);
		border-radius: 0 4px 4px 4px;
		padding: 12px 16px;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 13px;
		white-space: pre-wrap;
		word-break: break-all;
		user-select: all;
	}

	/* Spinner */
	@keyframes spin { to { transform: rotate(360deg); } }
	.spinner {
		display: inline-block;
		width: 14px; height: 14px;
		border: 2px solid var(--step-pending);
		border-top-color: var(--step-active);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		vertical-align: middle;
		margin-right: 6px;
	}

	.hidden { display: none; }
	.mt-8 { margin-top: 8px; }
	.mt-16 { margin-top: 16px; }
</style>
</head>
<body>
	<h1>Welcome to Ollama Code Review</h1>
	<p class="subtitle">Let's get you set up with AI-powered code reviews in a few steps.</p>

	<!-- Stepper -->
	<div class="stepper">
		<div class="step-indicator active" id="si-1">
			<div class="step-circle">1</div>
			<div class="step-label">Install Ollama</div>
		</div>
		<div class="step-indicator" id="si-2">
			<div class="step-circle">2</div>
			<div class="step-label">Choose a Model</div>
		</div>
		<div class="step-indicator" id="si-3">
			<div class="step-circle">3</div>
			<div class="step-label">Ready!</div>
		</div>
	</div>

	<!-- Step 1: Install Ollama -->
	<div class="panel visible" id="panel-1">
		<div class="card">
			<h2>Step 1 — Install Ollama</h2>
			<p>Ollama runs AI models locally on your machine. It's free and your code never leaves your computer.</p>

			<div id="ollama-status">
				<span class="status loading"><span class="spinner"></span> Checking Ollama...</span>
			</div>

			<div id="ollama-not-found" class="hidden">
				<div class="install-instructions">
					<p style="margin-top: 12px;">Install Ollama for your platform:</p>
					<div class="platform-tabs">
						<button class="active" onclick="showPlatform('mac')">macOS</button>
						<button onclick="showPlatform('linux')">Linux</button>
						<button onclick="showPlatform('windows')">Windows</button>
					</div>
					<div class="code-block" id="platform-mac">brew install ollama &amp;&amp; ollama serve</div>
					<div class="code-block hidden" id="platform-linux">curl -fsSL https://ollama.com/install.sh | sh</div>
					<div class="code-block hidden" id="platform-windows">Download from https://ollama.com/download/windows</div>
				</div>

				<div class="btn-row">
					<button class="btn-primary" onclick="openUrl('https://ollama.com/download')">Download Ollama</button>
					<button class="btn-secondary" onclick="checkOllama()">Re-check Connection</button>
				</div>
			</div>

			<div id="ollama-found" class="hidden">
				<p class="mt-8">
					<span id="model-count-msg"></span>
				</p>
				<div class="btn-row">
					<button class="btn-primary" onclick="goToStep(2)">Next — Choose a Model</button>
				</div>
			</div>
		</div>

		<div class="card">
			<h2>Or use Cloud Models instead</h2>
			<p>Don't want to install Ollama? You can use cloud-based AI models (Gemini, Claude, Mistral, etc.) — no local setup needed.</p>
			<div class="btn-row">
				<button class="btn-secondary" onclick="skipToCloud()">Use Cloud Models</button>
			</div>
		</div>
	</div>

	<!-- Step 2: Choose Model -->
	<div class="panel" id="panel-2">
		<div class="card">
			<h2>Step 2 — Choose an AI Model</h2>
			<p>Pick a model to use for code reviews. Smaller models are faster; larger models give better results.</p>

			<div class="model-grid" id="model-grid">
				<!-- Populated by JS -->
			</div>

			<div id="pull-status" class="hidden mt-16">
				<span class="status loading"><span class="spinner"></span> <span id="pull-msg">Pulling model...</span></span>
			</div>

			<div class="btn-row mt-16">
				<button class="btn-secondary" onclick="goToStep(1)">Back</button>
				<button class="btn-primary" id="btn-next-2" disabled onclick="goToStep(3)">Next — Finish</button>
			</div>
		</div>
	</div>

	<!-- Step 3: Ready -->
	<div class="panel" id="panel-3">
		<div class="card" style="text-align: center; padding: 32px;">
			<div style="font-size: 48px; margin-bottom: 12px;">&#x1F389;</div>
			<h2>You're All Set!</h2>
			<p>Here's how to start using Ollama Code Review:</p>

			<div style="text-align: left; max-width: 480px; margin: 16px auto 0;">
				<p><strong>Review Staged Changes</strong> — Open the Source Control panel and click the review icon, or run <code>Ollama: Review Staged Changes</code> from the Command Palette.</p>
				<p class="mt-8"><strong>Generate Commit Messages</strong> — Stage your changes, then run <code>Ollama: Generate Commit Message</code>.</p>
				<p class="mt-8"><strong>Inline Actions</strong> — Select code and use the lightbulb menu for Explain, Fix, Generate Tests, and Add Docs.</p>
				<p class="mt-8"><strong>Switch Models</strong> — Click the model name in the status bar at any time.</p>
			</div>

			<div class="btn-row" style="justify-content: center; margin-top: 24px;">
				<button class="btn-primary" onclick="finish()">Get Started</button>
				<button class="btn-secondary" onclick="goToStep(2)">Back</button>
			</div>
		</div>
	</div>

<script>
	const vscode = acquireVsCodeApi();
	let currentStep = 1;
	let ollamaRunning = false;
	let installedModels = [];

	const RECOMMENDED_MODELS = [
		{ name: 'qwen2.5-coder:7b', desc: 'Fast, great for code (4.7 GB)', size: '7B', recommended: true },
		{ name: 'qwen2.5-coder:14b', desc: 'Best balance of speed & quality (9 GB)', size: '14B', recommended: false },
		{ name: 'codellama:7b', desc: 'Meta\'s code-focused model (3.8 GB)', size: '7B', recommended: false },
		{ name: 'deepseek-coder-v2:16b', desc: 'Strong coding model (8.9 GB)', size: '16B', recommended: false },
		{ name: 'llama3.1:8b', desc: 'General-purpose, versatile (4.7 GB)', size: '8B', recommended: false },
		{ name: 'mistral:7b', desc: 'Fast general-purpose model (4.1 GB)', size: '7B', recommended: false },
	];

	function goToStep(step) {
		currentStep = step;
		// Update stepper indicators
		for (let i = 1; i <= 3; i++) {
			const si = document.getElementById('si-' + i);
			si.classList.remove('active', 'done');
			if (i < step) si.classList.add('done');
			if (i === step) si.classList.add('active');
		}
		// Show/hide panels
		document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
		const target = document.getElementById('panel-' + step);
		if (target) target.classList.add('visible');

		if (step === 2) renderModelGrid();
	}

	function renderModelGrid() {
		const grid = document.getElementById('model-grid');
		grid.innerHTML = '';
		RECOMMENDED_MODELS.forEach(m => {
			const isInstalled = installedModels.some(im => im.startsWith(m.name.split(':')[0]));
			const card = document.createElement('div');
			card.className = 'model-card' + (isInstalled ? ' installed' : '');
			card.innerHTML =
				'<div class="model-name">' + esc(m.name) + (m.recommended ? ' ⭐' : '') + '</div>' +
				'<div class="model-desc">' + esc(m.desc) + '</div>' +
				(isInstalled ? '<span class="model-tag">Installed</span>' : '');
			card.onclick = () => onModelClick(m.name, isInstalled);
			grid.appendChild(card);
		});
		updateNextButton();
	}

	function onModelClick(model, isInstalled) {
		if (isInstalled) {
			// Already installed — just select it and proceed
			vscode.postMessage({ command: 'pullModel', model: model });
			document.getElementById('btn-next-2').disabled = false;
			goToStep(3);
			return;
		}
		// Pull the model
		vscode.postMessage({ command: 'pullModel', model: model });
	}

	function updateNextButton() {
		const hasModel = installedModels.length > 0;
		document.getElementById('btn-next-2').disabled = !hasModel;
	}

	function checkOllama() {
		document.getElementById('ollama-status').innerHTML =
			'<span class="status loading"><span class="spinner"></span> Checking Ollama...</span>';
		document.getElementById('ollama-not-found').classList.add('hidden');
		document.getElementById('ollama-found').classList.add('hidden');
		vscode.postMessage({ command: 'checkOllama' });
	}

	function showPlatform(platform) {
		['mac', 'linux', 'windows'].forEach(p => {
			document.getElementById('platform-' + p).classList.toggle('hidden', p !== platform);
		});
		document.querySelectorAll('.platform-tabs button').forEach(b => b.classList.remove('active'));
		event.target.classList.add('active');
	}

	function skipToCloud() {
		vscode.postMessage({ command: 'selectCloudModel' });
		goToStep(3);
	}

	function openUrl(url) {
		vscode.postMessage({ command: 'openExternalUrl', model: url });
	}

	function finish() {
		vscode.postMessage({ command: 'finishSetup' });
	}

	function esc(s) {
		const d = document.createElement('div');
		d.textContent = s;
		return d.innerHTML;
	}

	// Listen for messages from extension
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
						: 'No models installed yet — we\\'ll set one up next.';
				document.getElementById('ollama-found').classList.remove('hidden');
				document.getElementById('ollama-not-found').classList.add('hidden');
			} else {
				document.getElementById('ollama-status').innerHTML =
					'<span class="status err"><span class="dot red"></span> Ollama not detected</span>';
				document.getElementById('ollama-not-found').classList.remove('hidden');
				document.getElementById('ollama-found').classList.add('hidden');
			}

			// Update model grid if on step 2
			if (currentStep === 2) renderModelGrid();
		}
	});

	// Initial check
	checkOllama();
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

	// Show a non-blocking prompt on first install
	const choice = await vscode.window.showInformationMessage(
		'Welcome to Ollama Code Review! Would you like to set up Ollama and choose a model?',
		'Open Setup Guide',
		'Use Cloud Models',
		'Dismiss',
	);

	if (choice === 'Open Setup Guide') {
		showSetupGuidePanel(context);
	} else if (choice === 'Use Cloud Models') {
		await context.globalState.update(SETUP_COMPLETE_KEY, true);
		await vscode.commands.executeCommand('ollama-code-review.selectModel');
	} else {
		// Dismiss — mark as completed so we don't nag
		await context.globalState.update(SETUP_COMPLETE_KEY, true);
	}
}

/**
 * Show the setup guide on demand (from command palette).
 */
export function showSetupGuide(context: vscode.ExtensionContext): void {
	showSetupGuidePanel(context);
}
