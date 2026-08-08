/**
 * F-050: Sitecore Schema Explorer — Interactive WebviewPanel
 *
 * Provides an interactive panel where developers can:
 * 1. Input a route path
 * 2. Fetch layout data from Sitecore Experience Edge
 * 3. Browse discovered placeholders and components
 * 4. Search/select components to inspect fields
 * 5. Save schema for validation use
 * 6. Copy TypeScript interfaces
 */
import * as vscode from 'vscode';
import type {
	ExplorerPanelMessage,
	SitecoreSchemaCache,
	SitecoreRawSamples,
} from './types';
import { resolveEnvConfig, saveSchemaCache, getSitecoreConfig } from './schemaFetcher';
import { createEmptyCache, mergeIntoCache, parseLayoutResponse } from './responseParser';
import { fetchLayoutServiceData } from './graphqlClient';
import { generateTypescriptInterface } from './promptBuilder';

// ---------------------------------------------------------------------------
// Explorer Panel
// ---------------------------------------------------------------------------

export class SitecoreExplorerPanel {
	public static readonly viewType = 'sitecore-schema-explorer';
	private static _instance: SitecoreExplorerPanel | undefined;

	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];
	private _schemaCache: SitecoreSchemaCache;
	/** Raw Layout Service values for this session only — never persisted. */
	private _rawSamples: SitecoreRawSamples = {};
	private _outputChannel?: vscode.OutputChannel;

	private constructor(
		panel: vscode.WebviewPanel,
		outputChannel?: vscode.OutputChannel,
	) {
		this._panel = panel;
		this._outputChannel = outputChannel;
		this._schemaCache = createEmptyCache();

		// Set webview content
		this._panel.webview.html = this._getHtmlContent();

		// Handle messages from webview
		this._panel.webview.onDidReceiveMessage(
			(message: ExplorerPanelMessage) => this._handleMessage(message),
			null,
			this._disposables,
		);

		// Handle panel disposal
		this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
	}

	/**
	 * Creates or shows the explorer panel.
	 */
	public static createOrShow(
		extensionUri: vscode.Uri,
		outputChannel?: vscode.OutputChannel,
	): SitecoreExplorerPanel {
		const column = vscode.ViewColumn.Beside;

		// If panel already exists, reveal it
		if (SitecoreExplorerPanel._instance) {
			SitecoreExplorerPanel._instance._panel.reveal(column);
			return SitecoreExplorerPanel._instance;
		}

		// Create a new panel
		const panel = vscode.window.createWebviewPanel(
			SitecoreExplorerPanel.viewType,
			'Sitecore Schema Explorer',
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				// The panel ships its own inline HTML and loads no local assets;
				// scoping the roots to the extension keeps it that way.
				localResourceRoots: [extensionUri],
			},
		);

		SitecoreExplorerPanel._instance = new SitecoreExplorerPanel(
			panel,
			outputChannel,
		);

		return SitecoreExplorerPanel._instance;
	}

	// ---------------------------------------------------------------------------
	// Message handling
	// ---------------------------------------------------------------------------

	private async _handleMessage(message: ExplorerPanelMessage): Promise<void> {
		switch (message.type) {
			case 'get-config':
				await this._handleGetConfig();
				break;
			case 'fetch-layout':
				await this._handleFetchLayout(message.route);
				break;
			case 'select-component':
				this._handleSelectComponent(message.componentName);
				break;
			case 'save-schema':
				await this._handleSaveSchema();
				break;
			case 'copy-typescript':
				this._handleCopyTypescript(message.componentName);
				break;
			case 'copy-json':
				this._handleCopyJson(message.componentName);
				break;
			case 'copy-raw':
				this._handleCopyRaw(message.componentName);
				break;
			case 'use-for-validation':
				await this._handleUseForValidation(message.components);
				break;
		}
	}

	private async _handleGetConfig(): Promise<void> {
		const scConfig = getSitecoreConfig();
		const envConfig = await resolveEnvConfig(this._outputChannel);
		if (envConfig) {
			const source = (scConfig.graphqlEndpoint && scConfig.apiKey) ? 'settings' : 'env';
			this._postMessage({
				type: 'config',
				endpoint: envConfig.graphqlEndpoint,
				siteName: envConfig.siteName,
				source,
			});
		} else {
			this._postMessage({
				type: 'config',
				endpoint: '',
				siteName: '',
				source: 'none',
			});
		}
	}

	private async _handleFetchLayout(route: string): Promise<void> {
		this._postMessage({ type: 'loading', active: true });

		try {
			const envConfig = await resolveEnvConfig(this._outputChannel);
			if (!envConfig) {
				this._postMessage({
					type: 'error',
					message: 'No Sitecore configuration found. Add SITECORE_API_KEY and GRAPH_QL_ENDPOINT to .env.local, or configure in extension settings.',
				});
				return;
			}

			const response = await fetchLayoutServiceData(envConfig, route);
			if (!response) {
				this._postMessage({
					type: 'error',
					message: `No layout data returned for route "${route}". The route may not exist or has no renderings.`,
				});
				return;
			}

			// Fresh fetch — reset cache so we never show stale data
			this._schemaCache = createEmptyCache();
			this._rawSamples = {};

			const parsed = parseLayoutResponse(response, route);
			mergeIntoCache(this._schemaCache, parsed, route, `graphql:${envConfig.graphqlEndpoint}`);

			// Accumulate raw values
			for (const [componentName, fields] of Object.entries(parsed.rawSamples)) {
				const bucket = this._rawSamples[componentName] ?? (this._rawSamples[componentName] = {});
				for (const [fieldName, value] of Object.entries(fields)) {
					if (!(fieldName in bucket)) { bucket[fieldName] = value; }
				}
			}

			this._postMessage({
				type: 'layout-result',
				placeholders: this._schemaCache.placeholders,
				components: parsed.renderings,
				routePath: route,
			});
		} catch (err: unknown) {
			this._postMessage({
				type: 'error',
				message: (err as Error).message || String(err),
			});
		} finally {
			this._postMessage({ type: 'loading', active: false });
		}
	}

	private _handleSelectComponent(componentName: string): void {
		const component = this._schemaCache.components[componentName];
		if (component) {
			this._postMessage({
				type: 'component-detail',
				component,
				raw: this._rawSamples[componentName],
			});
		} else {
			this._postMessage({ type: 'error', message: `Component "${componentName}" not found.` });
		}
	}

	private async _handleSaveSchema(): Promise<void> {
		try {
			const filePath = await saveSchemaCache(this._schemaCache, this._outputChannel);
			this._postMessage({ type: 'schema-saved', path: filePath });
			vscode.window.showInformationMessage(`Sitecore schema saved to ${filePath}`);
		} catch (err: unknown) {
			this._postMessage({ type: 'error', message: (err as Error).message || String(err) });
		}
	}

	private _handleCopyTypescript(componentName: string): void {
		const component = this._schemaCache.components[componentName];
		if (!component) {
			this._postMessage({ type: 'error', message: `Component "${componentName}" not found.` });
			return;
		}

		const tsCode = generateTypescriptInterface(component);
		vscode.env.clipboard.writeText(tsCode);
		vscode.window.showInformationMessage(`TypeScript interface for ${componentName} copied to clipboard.`);
	}

	private _handleCopyJson(componentName: string): void {
		const component = this._schemaCache.components[componentName];
		if (!component) {
			this._postMessage({ type: 'error', message: `Component "${componentName}" not found.` });
			return;
		}

		const json = JSON.stringify(component, null, 2);
		vscode.env.clipboard.writeText(json);
		vscode.window.showInformationMessage(`Derived schema for ${componentName} copied to clipboard.`);
	}

	/** Copies the raw Layout Service payload — ground truth, not the derived schema. */
	private _handleCopyRaw(componentName: string): void {
		const raw = this._rawSamples[componentName];
		if (!raw) {
			this._postMessage({
				type: 'error',
				message: `No raw sample retained for "${componentName}". Fetch a route where it appears.`,
			});
			return;
		}

		vscode.env.clipboard.writeText(JSON.stringify(raw, null, 2));
		vscode.window.showInformationMessage(
			`Raw Layout Service values for ${componentName} copied to clipboard.`
		);
	}

	private async _handleUseForValidation(componentNames: string[]): Promise<void> {
		// Filter schema to only include selected components
		const filteredCache: SitecoreSchemaCache = {
			...this._schemaCache,
			components: {},
		};

		for (const name of componentNames) {
			if (this._schemaCache.components[name]) {
				filteredCache.components[name] = this._schemaCache.components[name];
			}
		}

		try {
			const filePath = await saveSchemaCache(filteredCache, this._outputChannel);
			this._postMessage({ type: 'schema-saved', path: filePath });
			vscode.window.showInformationMessage(
				`Saved ${componentNames.length} component(s) to ${filePath} for validation.`
			);
		} catch (err: unknown) {
			this._postMessage({ type: 'error', message: (err as Error).message || String(err) });
		}
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private _postMessage(message: unknown): void {
		this._panel.webview.postMessage(message);
	}

	private _dispose(): void {
		SitecoreExplorerPanel._instance = undefined;
		this._panel.dispose();
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables = [];
	}

	private _getNonce(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let nonce = '';
		for (let i = 0; i < 32; i++) {
			nonce += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return nonce;
	}

	// ---------------------------------------------------------------------------
	// Webview HTML
	// ---------------------------------------------------------------------------

	private _getHtmlContent(): string {
		const nonce = this._getNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Sitecore Schema Explorer</title>
	<style>
		:root {
			--bg: var(--vscode-editor-background);
			--fg: var(--vscode-editor-foreground);
			--input-bg: var(--vscode-input-background);
			--input-border: var(--vscode-input-border);
			--input-fg: var(--vscode-input-foreground);
			--button-bg: var(--vscode-button-background);
			--button-fg: var(--vscode-button-foreground);
			--button-hover: var(--vscode-button-hoverBackground);
			--border: var(--vscode-panel-border);
			--badge-bg: var(--vscode-badge-background);
			--badge-fg: var(--vscode-badge-foreground);
			--error-fg: var(--vscode-errorForeground);
			--success: var(--vscode-testing-iconPassed);
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); padding: 16px; }
		h2 { font-size: 1.2em; margin-bottom: 12px; }
		h3 { font-size: 1em; margin: 12px 0 8px; }

		.section { border: 1px solid var(--border); border-radius: 4px; padding: 12px; margin-bottom: 12px; }
		.row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
		.row label { min-width: 70px; font-weight: 600; }

		input[type="text"] {
			flex: 1; padding: 6px 10px; background: var(--input-bg); color: var(--input-fg);
			border: 1px solid var(--input-border); border-radius: 3px; font-size: inherit;
		}
		button {
			padding: 6px 14px; background: var(--button-bg); color: var(--button-fg);
			border: none; border-radius: 3px; cursor: pointer; font-size: inherit;
		}
		button:hover { background: var(--button-hover); }
		button:disabled { opacity: 0.5; cursor: not-allowed; }
		.btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--fg); }

		.status { font-size: 0.85em; padding: 4px 8px; border-radius: 3px; display: inline-flex; align-items: center; gap: 4px; }
		.status-ok { background: rgba(40, 167, 69, 0.15); color: var(--success); }
		.status-warn { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
		.status-error { background: rgba(220, 53, 69, 0.15); color: var(--error-fg); }

		.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
		.chip {
			padding: 4px 10px; border-radius: 12px; font-size: 0.85em;
			background: var(--badge-bg); color: var(--badge-fg); cursor: pointer;
		}
		.chip:hover { opacity: 0.8; }
		.chip.active { outline: 2px solid var(--button-bg); }

		.search-box { width: 100%; padding: 6px 10px; margin-bottom: 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 3px; }

		.component-list { list-style: none; max-height: 200px; overflow-y: auto; }
		.component-item {
			display: flex; align-items: center; gap: 8px; padding: 6px 8px;
			border-bottom: 1px solid var(--border); cursor: pointer;
		}
		.component-item:hover { background: var(--input-bg); }
		.component-item input[type="checkbox"] { margin: 0; }
		.component-name { font-weight: 600; flex: 1; }
		.component-meta { font-size: 0.8em; opacity: 0.7; }

		table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
		th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
		th { font-weight: 600; background: var(--input-bg); }
		code { background: var(--input-bg); padding: 1px 4px; border-radius: 2px; font-size: 0.9em; }

		.loading { display: none; align-items: center; gap: 8px; padding: 12px; }
		.loading.active { display: flex; }
		.spinner { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--button-bg); border-radius: 50%; animation: spin 0.6s linear infinite; }
		@keyframes spin { to { transform: rotate(360deg); } }

		.error { background: rgba(220, 53, 69, 0.1); border: 1px solid rgba(220, 53, 69, 0.3); border-radius: 4px; padding: 8px 12px; margin: 8px 0; display: none; }
		.error.visible { display: block; }

		.detail-section { display: none; }
		.detail-section.visible { display: block; }
		.actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

		tr.field-row { cursor: pointer; }
		tr.field-row:hover { background: var(--input-bg); }
		tr.field-row td:first-child::before {
			content: '▸'; display: inline-block; width: 12px; opacity: 0.6; font-size: 0.85em;
		}
		tr.field-row.open td:first-child::before { content: '▾'; }
		.shape { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; opacity: 0.85; word-break: break-all; }
		tr.raw-row > td { padding: 0 8px 8px; border-bottom: 1px solid var(--border); }
		tr.raw-row pre {
			margin: 0; padding: 8px; background: var(--input-bg); border-radius: 3px;
			font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em;
			white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow: auto;
		}
		.raw-missing { font-size: 0.85em; opacity: 0.7; padding: 6px 8px; }
		.hint { font-size: 0.85em; opacity: 0.7; margin-bottom: 8px; }

		#routes-list { font-size: 0.8em; opacity: 0.7; margin-top: 4px; }
	</style>
</head>
<body>
	<h2>Sitecore Schema Explorer</h2>

	<!-- Connection -->
	<div class="section">
		<div class="row">
			<label>Endpoint:</label>
			<span id="endpoint-display">Detecting...</span>
			<span id="connection-status" class="status">...</span>
		</div>
		<div class="row">
			<label>Site:</label>
			<span id="site-display">—</span>
		</div>
		<div class="row">
			<label>Route:</label>
			<input type="text" id="route-input" placeholder="/path-to-page" value="/" />
			<button id="fetch-btn">Fetch</button>
		</div>
		<div id="routes-list"></div>
	</div>

	<!-- Loading -->
	<div class="loading" id="loading">
		<div class="spinner"></div>
		<span>Fetching layout data...</span>
	</div>

	<!-- Error -->
	<div class="error" id="error-box"></div>

	<!-- Placeholders -->
	<div class="section detail-section" id="placeholders-section">
		<h3>Placeholders</h3>
		<div class="chips" id="placeholders-chips"></div>
	</div>

	<!-- Components -->
	<div class="section detail-section" id="components-section">
		<h3>Components <span id="component-count"></span></h3>
		<input type="text" class="search-box" id="component-search" placeholder="Search components..." />
		<ul class="component-list" id="component-list"></ul>
		<div class="actions">
			<button id="save-btn" class="btn-secondary" disabled>Save Schema</button>
			<button id="validate-btn" disabled>Use Selected for Validation</button>
		</div>
	</div>

	<!-- Component Detail -->
	<div class="section detail-section" id="detail-section">
		<h3 id="detail-title">Component Detail</h3>
		<div class="hint">Click a field to see its real Layout Service JSON.</div>
		<table id="detail-table">
			<thead><tr><th>Field Name</th><th>Type</th><th>Shape</th></tr></thead>
			<tbody id="detail-body"></tbody>
		</table>
		<div id="child-detail"></div>
		<div class="actions">
			<button id="copy-ts-btn" class="btn-secondary">Copy as TypeScript</button>
			<button id="copy-json-btn" class="btn-secondary">Copy derived schema</button>
			<button id="copy-raw-btn" class="btn-secondary">Copy raw JSON</button>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let allComponents = [];
		let selectedComponents = new Set();
		let activeFilter = null;
		let currentComponentName = null;

		/** Escape HTML special characters to prevent XSS. */
		function esc(str) {
			if (str == null) return '';
			return String(str)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		// Elements
		const routeInput = document.getElementById('route-input');
		const fetchBtn = document.getElementById('fetch-btn');
		const loading = document.getElementById('loading');
		const errorBox = document.getElementById('error-box');
		const placeholdersSection = document.getElementById('placeholders-section');
		const componentsSection = document.getElementById('components-section');
		const detailSection = document.getElementById('detail-section');
		const componentSearch = document.getElementById('component-search');
		const componentList = document.getElementById('component-list');
		const saveBtn = document.getElementById('save-btn');
		const validateBtn = document.getElementById('validate-btn');
		const copyTsBtn = document.getElementById('copy-ts-btn');
		const routesList = document.getElementById('routes-list');


		// Init
		vscode.postMessage({ type: 'get-config' });

		// Event listeners
		fetchBtn.addEventListener('click', () => {
			const route = routeInput.value.trim();
			if (route) { vscode.postMessage({ type: 'fetch-layout', route }); }
		});

		routeInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				fetchBtn.click();
			}
		});
		componentSearch.addEventListener('input', () => renderComponentList());
		saveBtn.addEventListener('click', () => vscode.postMessage({ type: 'save-schema' }));
		validateBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'use-for-validation', components: Array.from(selectedComponents) });
		});
		copyTsBtn.addEventListener('click', () => {
			if (currentComponentName) {
				vscode.postMessage({ type: 'copy-typescript', componentName: currentComponentName });
			}
		});
		document.getElementById('copy-json-btn').addEventListener('click', () => {
			if (currentComponentName) {
				vscode.postMessage({ type: 'copy-json', componentName: currentComponentName });
			}
		});
		document.getElementById('copy-raw-btn').addEventListener('click', () => {
			if (currentComponentName) {
				vscode.postMessage({ type: 'copy-raw', componentName: currentComponentName });
			}
		});

		// Message handler
		window.addEventListener('message', (event) => {
			const msg = event.data;
			switch (msg.type) {
				case 'config':
					document.getElementById('endpoint-display').textContent = msg.endpoint || 'Not configured';
					document.getElementById('site-display').textContent = msg.siteName || '—';
					const status = document.getElementById('connection-status');
					if (msg.source === 'env') {
						status.textContent = '● Connected (from .env)';
						status.className = 'status status-ok';
					} else if (msg.source === 'settings') {
						status.textContent = '● Connected (settings)';
						status.className = 'status status-ok';
					} else {
						status.textContent = '○ Not configured';
						status.className = 'status status-warn';
					}
					break;

				case 'loading':
					loading.className = msg.active ? 'loading active' : 'loading';
					errorBox.className = 'error';
					break;

				case 'error':
					errorBox.textContent = msg.message;
					errorBox.className = 'error visible';
					break;

				case 'layout-result':
					errorBox.className = 'error';
					selectedComponents.clear();
					validateBtn.disabled = true;
					activeFilter = null;
					detailSection.className = 'section detail-section';
					renderPlaceholders(msg.placeholders);
					allComponents = msg.components;
					renderComponentList();
					placeholdersSection.className = 'section detail-section visible';
					componentsSection.className = 'section detail-section visible';
					saveBtn.disabled = false;
					routesList.textContent = 'Route: ' + msg.routePath;
					break;



				case 'component-detail':
					renderComponentDetail(msg.component, msg.raw);
					detailSection.className = 'section detail-section visible';
					break;

				case 'schema-saved':
					// Show brief success
					errorBox.textContent = 'Schema saved to ' + msg.path;
					errorBox.className = 'error visible';
					errorBox.style.background = 'rgba(40, 167, 69, 0.1)';
					errorBox.style.borderColor = 'rgba(40, 167, 69, 0.3)';
					setTimeout(() => { errorBox.className = 'error'; errorBox.style = ''; }, 3000);
					break;
			}
		});

		function renderPlaceholders(placeholders) {
			const container = document.getElementById('placeholders-chips');
			container.innerHTML = placeholders.map(ph =>
				'<span class="chip' + (activeFilter === ph ? ' active' : '') + '" data-ph="' + esc(ph) + '">' + esc(ph) + '</span>'
			).join('');
			container.querySelectorAll('.chip').forEach(chip => {
				chip.addEventListener('click', () => {
					const ph = chip.dataset.ph;
					activeFilter = activeFilter === ph ? null : ph;
					container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
					if (activeFilter) chip.classList.add('active');
					renderComponentList();
				});
			});
		}

		function renderComponentList() {
			const search = componentSearch.value.toLowerCase();
			let filtered = allComponents;
			if (activeFilter) {
				filtered = filtered.filter(c => c.placeholder === activeFilter);
			}
			if (search) {
				filtered = filtered.filter(c => c.componentName.toLowerCase().includes(search));
			}

			document.getElementById('component-count').textContent = '(' + filtered.length + ')';
			componentList.innerHTML = filtered.map(c => {
				const checked = selectedComponents.has(c.componentName) ? 'checked' : '';
				return '<li class="component-item" data-name="' + esc(c.componentName) + '" data-index="' + c.index + '">'
					+ '<input type="checkbox" ' + checked + ' data-check="' + esc(c.componentName) + '" />'
					+ '<span class="component-name">' + esc(c.componentName) + '</span>'
					+ '<span class="component-meta">(' + esc(c.placeholder) + ') ' + esc(String(c.fieldCount)) + ' fields' + (c.hasChildren ? ' + children' : '') + '</span>'
					+ '</li>';
			}).join('');

			// Click handlers
			componentList.querySelectorAll('.component-item').forEach(item => {
				item.addEventListener('click', (e) => {
					if (e.target.type === 'checkbox') return;
					const name = item.dataset.name;
					currentComponentName = name;
					vscode.postMessage({ type: 'select-component', componentName: name });
				});
			});
			componentList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
				cb.addEventListener('change', () => {
					const name = cb.dataset.check;
					if (cb.checked) selectedComponents.add(name);
					else selectedComponents.delete(name);
					validateBtn.disabled = selectedComponents.size === 0;
				});
			});
		}

		/** One field row plus a collapsed row holding its real JSON. */
		function fieldRows(fields, raw, keyPrefix) {
			return fields.map((f, i) => {
				const id = keyPrefix + i;
				const hasRaw = raw && Object.prototype.hasOwnProperty.call(raw, f.name);
				const body = hasRaw
					? '<pre>' + esc(JSON.stringify(raw[f.name], null, 2)) + '</pre>'
					: '<div class="raw-missing">No raw sample retained for this field. '
						+ 'Child-item fields and cache-loaded schemas have no sample — the Shape column is derived from one.</div>';
				return '<tr class="field-row" data-row="' + id + '">'
						+ '<td><code>' + esc(f.name) + '</code>' + (f.observed ? '' : ' <em>(empty)</em>') + '</td>'
						+ '<td>' + esc(f.type) + '</td>'
						+ '<td class="shape"><code>' + esc(f.shape || f.notes || '—') + '</code></td>'
					+ '</tr>'
					+ '<tr class="raw-row" data-raw="' + id + '" hidden><td colspan="3">' + body + '</td></tr>';
			}).join('');
		}

		/** Toggle handlers for every field row inside a container. */
		function wireFieldRows(container) {
			container.querySelectorAll('tr.field-row').forEach(row => {
				row.addEventListener('click', () => {
					const target = container.querySelector('tr.raw-row[data-raw="' + row.dataset.row + '"]');
					if (!target) return;
					target.hidden = !target.hidden;
					row.classList.toggle('open', !target.hidden);
				});
			});
		}

		function renderComponentDetail(component, raw) {
			document.getElementById('detail-title').textContent = component.componentName;
			currentComponentName = component.componentName;

			const tbody = document.getElementById('detail-body');
			tbody.innerHTML = fieldRows(component.fields, raw, 'f');
			wireFieldRows(tbody);

			const childDiv = document.getElementById('child-detail');
			if (component.childFields && component.childFields.length > 0) {
				childDiv.innerHTML = '<h3 style="margin-top:12px">Child: ' + esc(component.childTemplateName || 'Child') + '</h3>'
					+ '<table><thead><tr><th>Field Name</th><th>Type</th><th>Shape</th></tr></thead><tbody>'
					+ fieldRows(component.childFields, null, 'c')
					+ '</tbody></table>';
				wireFieldRows(childDiv);
			} else {
				childDiv.innerHTML = '';
			}
		}
	</script>
</body>
</html>`;
	}
}
