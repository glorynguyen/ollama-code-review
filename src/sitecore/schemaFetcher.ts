/**
 * F-050: Sitecore Layout Service Schema Validation — Schema Fetcher
 *
 * Orchestrates schema loading from various sources:
 * 1. Auto-detect .env.local → call GraphQL
 * 2. Local cache file (.sitecore/schema-cache.json)
 * 3. VS Code settings override
 *
 * Follows the same caching pattern as contentstack/schemaFetcher.ts (F-032).
 */
import * as vscode from 'vscode';
import type { SitecoreConfig, SitecoreSchemaCache, SitecoreEnvConfig } from './types';
import { detectSitecoreEnv } from './envDetector';
import { fetchLayoutServiceData } from './graphqlClient';
import { parseLayoutResponse, mergeIntoCache, createEmptyCache } from './responseParser';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_LOCAL_PATH = '.sitecore/schema-cache.json';
const DEFAULT_CACHE_TTL_MINUTES = 60;
const DEFAULT_MAX_COMPONENTS = 10;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let _cachedSchema: SitecoreSchemaCache | null | undefined = undefined;
let _cachedWorkspaceRoot: string | undefined = undefined;
let _cacheTimestamp: number | undefined = undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Read Sitecore validation settings from VS Code configuration. */
export function getSitecoreConfig(): SitecoreConfig {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const sc = config.get<Partial<SitecoreConfig>>('sitecore', {});
	return {
		enabled: sc.enabled ?? false,
		schemaSource: sc.schemaSource ?? 'auto',
		envFile: sc.envFile ?? '.env.local',
		graphqlEndpoint: sc.graphqlEndpoint ?? '',
		apiKey: sc.apiKey ?? '',
		siteName: sc.siteName ?? '',
		localSchemaPath: sc.localSchemaPath ?? DEFAULT_LOCAL_PATH,
		cacheTtlMinutes: sc.cacheTtlMinutes ?? DEFAULT_CACHE_TTL_MINUTES,
		maxComponents: sc.maxComponents ?? DEFAULT_MAX_COMPONENTS,
		validateFieldTypes: sc.validateFieldTypes ?? true,
		validatePlaceholders: sc.validatePlaceholders ?? true,
	};
}

/**
 * Loads Sitecore schema based on the configured source.
 * Returns the schema cache, or null if unavailable.
 *
 * Results are cached until {@link clearSitecoreSchemaCache} is called,
 * the workspace root changes, or the TTL expires.
 */
export async function loadSitecoreSchema(
	outputChannel?: vscode.OutputChannel,
): Promise<SitecoreSchemaCache | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return null;
	}

	const workspaceRoot = workspaceFolders[0].uri;
	const workspaceRootStr = workspaceRoot.toString();
	const scConfig = getSitecoreConfig();

	// Invalidate cache when workspace changes
	if (_cachedWorkspaceRoot !== workspaceRootStr) {
		_cachedSchema = undefined;
		_cachedWorkspaceRoot = workspaceRootStr;
	}

	// Check TTL
	if (_cachedSchema !== undefined && _cacheTimestamp) {
		const ageMs = Date.now() - _cacheTimestamp;
		const ttlMs = scConfig.cacheTtlMinutes * 60 * 1000;
		if (ageMs < ttlMs) {
			return _cachedSchema;
		}
		// TTL expired — clear cache so it is re-fetched below
		_cachedSchema = undefined;
		_cacheTimestamp = undefined;
	}

	try {
		let schema: SitecoreSchemaCache | null = null;

		if (scConfig.schemaSource === 'local') {
			schema = await _loadFromLocalFile(workspaceRoot, scConfig, outputChannel);
		} else {
			// 'auto' or 'graphql' — try GraphQL first, fall back to local
			schema = await _loadFromGraphQL(scConfig, outputChannel);

			// Fall back to local cache for 'auto' mode
			if (!schema && scConfig.schemaSource === 'auto') {
				schema = await _loadFromLocalFile(workspaceRoot, scConfig, outputChannel);
			}
		}

		// Only cache non-null results — leave _cachedSchema as undefined
		// when schema is null so the next call retries immediately.
		if (schema) {
			_cachedSchema = schema;
			_cacheTimestamp = Date.now();
		}
		return schema;
	} catch (err: unknown) {
		const msg = `Sitecore schema could not be loaded: ${(err as Error)?.message ?? String(err)}`;
		outputChannel?.appendLine(`[Sitecore] Warning: ${msg}`);
		// Do not cache null results — leave _cachedSchema as undefined so the
		// next call retries instead of suppressing loads for the full TTL.
		return null;
	}
}

/**
 * Fetches schema from the Layout Service for a specific route.
 * Used by the explorer panel for on-demand fetching.
 *
 * @param routePath  Route to fetch (e.g. "/bento-grid")
 * @param envConfig  Connection config (from env detection or settings)
 * @param outputChannel  For logging
 * @returns The parsed schema cache with data from this route
 */
export async function fetchSchemaForRoute(
	routePath: string,
	envConfig: SitecoreEnvConfig,
	outputChannel?: vscode.OutputChannel,
): Promise<SitecoreSchemaCache> {
	outputChannel?.appendLine(`[Sitecore] Fetching layout for route: ${routePath}`);

	const response = await fetchLayoutServiceData(envConfig, routePath);
	if (!response) {
		throw new Error(`No layout data returned for route "${routePath}".`);
	}

	const parsed = parseLayoutResponse(response, routePath);
	const cache = createEmptyCache();
	mergeIntoCache(cache, parsed, routePath, `graphql:${envConfig.graphqlEndpoint}`);

	outputChannel?.appendLine(
		`[Sitecore] Discovered ${Object.keys(cache.components).length} component(s), `
		+ `${cache.placeholders.length} placeholder(s) from ${routePath}`
	);

	return cache;
}

/**
 * Resolves the effective Sitecore environment config from settings or .env.
 * Used by the explorer panel and schema fetcher.
 */
export async function resolveEnvConfig(
	outputChannel?: vscode.OutputChannel,
): Promise<SitecoreEnvConfig | null> {
	const scConfig = getSitecoreConfig();

	// Check if settings override env detection
	if (scConfig.graphqlEndpoint && scConfig.apiKey) {
		return {
			apiKey: scConfig.apiKey,
			graphqlEndpoint: scConfig.graphqlEndpoint,
			siteName: scConfig.siteName || 'website',
		};
	}

	// Auto-detect from .env file
	const detected = await detectSitecoreEnv(scConfig.envFile);
	if (detected) {
		outputChannel?.appendLine(
			`[Sitecore] Auto-detected config from ${scConfig.envFile}: `
			+ `endpoint=${detected.graphqlEndpoint}, site=${detected.siteName}`
		);
		return detected;
	}

	return null;
}

/**
 * Saves a schema cache to the local file for offline use.
 */
export async function saveSchemaCache(
	schema: SitecoreSchemaCache,
	outputChannel?: vscode.OutputChannel,
): Promise<string> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		throw new Error('No workspace folder open.');
	}

	const scConfig = getSitecoreConfig();
	const workspaceRoot = workspaceFolders[0].uri;
	const filePath = scConfig.localSchemaPath;
	const fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);

	// Ensure directory exists
	const dirUri = vscode.Uri.joinPath(workspaceRoot, filePath.split('/').slice(0, -1).join('/'));
	try {
		await vscode.workspace.fs.createDirectory(dirUri);
	} catch { /* directory may already exist */ }

	const content = JSON.stringify(schema, null, 2);
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));

	outputChannel?.appendLine(`[Sitecore] Schema saved to ${filePath}`);

	// Update cache
	_cachedSchema = schema;
	_cacheTimestamp = Date.now();

	return filePath;
}

/** Clears the cached schema so the next call re-fetches. */
export function clearSitecoreSchemaCache(): void {
	_cachedSchema = undefined;
	_cacheTimestamp = undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetches schema from Experience Edge via GraphQL for the root route.
 */
async function _loadFromGraphQL(
	scConfig: SitecoreConfig,
	outputChannel?: vscode.OutputChannel,
): Promise<SitecoreSchemaCache | null> {
	const envConfig = await resolveEnvConfig(outputChannel);
	if (!envConfig) {
		outputChannel?.appendLine('[Sitecore] No GraphQL endpoint configured — cannot fetch from Experience Edge.');
		return null;
	}

	try {
		const response = await fetchLayoutServiceData(envConfig, '/');
		if (!response) {
			outputChannel?.appendLine('[Sitecore] No layout data returned for root route "/".');
			return null;
		}

		const parsed = parseLayoutResponse(response, '/');
		const cache = createEmptyCache();
		mergeIntoCache(cache, parsed, '/', `graphql:${envConfig.graphqlEndpoint}`);

		outputChannel?.appendLine(
			`[Sitecore] Fetched ${Object.keys(cache.components).length} component(s) via GraphQL`
		);

		return cache;
	} catch (err: unknown) {
		outputChannel?.appendLine(
			`[Sitecore] GraphQL fetch failed: ${(err as Error)?.message ?? String(err)}`
		);
		return null;
	}
}

/**
 * Loads schema from the local JSON file.
 */
async function _loadFromLocalFile(
	workspaceRoot: vscode.Uri,
	scConfig: SitecoreConfig,
	outputChannel?: vscode.OutputChannel,
): Promise<SitecoreSchemaCache | null> {
	const fileUri = vscode.Uri.joinPath(workspaceRoot, scConfig.localSchemaPath);

	try {
		const content = await vscode.workspace.fs.readFile(fileUri);
		const text = Buffer.from(content).toString('utf8');
		const schema = JSON.parse(text) as SitecoreSchemaCache;

		if (!schema.components || typeof schema.components !== 'object') {
			outputChannel?.appendLine(
				`[Sitecore] ${scConfig.localSchemaPath} is missing "components" object.`
			);
			return null;
		}

		outputChannel?.appendLine(
			`[Sitecore] Loaded ${Object.keys(schema.components).length} component schema(s) from ${scConfig.localSchemaPath}`
		);

		return schema;
	} catch {
		outputChannel?.appendLine(
			`[Sitecore] Local schema file not found: ${scConfig.localSchemaPath}. Use the Schema Explorer to fetch and save.`
		);
		return null;
	}
}
