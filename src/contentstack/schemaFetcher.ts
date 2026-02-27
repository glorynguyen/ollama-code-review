/**
 * F-032: Contentstack Schema Validation — Schema Fetcher
 *
 * Fetches Content Type schemas from the Contentstack Management API or
 * reads them from a local JSON export file. Results are cached for the
 * lifetime of the workspace session and can be invalidated by calling
 * {@link clearSchemaCache}.
 *
 * Follows the same caching pattern as `knowledge/loader.ts` (F-012).
 */
import * as vscode from 'vscode';
import axios from 'axios';
import type { ContentTypeSchema, ContentstackConfig, ContentstackSchemaExport } from './types';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_API_HOST = 'https://api.contentstack.io';
const DEFAULT_LOCAL_PATH = '.contentstack/schema.json';
const DEFAULT_MAX_CONTENT_TYPES = 5;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** `undefined` = not yet loaded; `null` = unavailable / error */
let _cachedSchemas: ContentTypeSchema[] | null | undefined = undefined;
let _cachedWorkspaceRoot: string | undefined = undefined;

// ---------------------------------------------------------------------------
// Configuration helper
// ---------------------------------------------------------------------------

/** Read Contentstack validation settings from VS Code configuration. */
export function getContentstackConfig(): ContentstackConfig {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const cs = config.get<Partial<ContentstackConfig>>('contentstack', {});
	return {
		enabled: cs.enabled ?? false,
		schemaSource: cs.schemaSource ?? 'local',
		apiKey: cs.apiKey ?? '',
		managementToken: cs.managementToken ?? '',
		apiHost: cs.apiHost ?? DEFAULT_API_HOST,
		localSchemaPath: cs.localSchemaPath ?? DEFAULT_LOCAL_PATH,
		maxContentTypes: cs.maxContentTypes ?? DEFAULT_MAX_CONTENT_TYPES,
	};
}

// ---------------------------------------------------------------------------
// Core loader
// ---------------------------------------------------------------------------

/**
 * Loads Content Type schemas based on the configured source.
 * Returns the list of content types, or `null` if unavailable.
 *
 * Results are cached until {@link clearSchemaCache} is called or the
 * workspace root changes.
 */
export async function loadContentstackSchemas(
	outputChannel?: vscode.OutputChannel,
): Promise<ContentTypeSchema[] | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return null;
	}

	const workspaceRoot = workspaceFolders[0].uri;
	const workspaceRootStr = workspaceRoot.toString();

	// Invalidate cache when workspace changes
	if (_cachedWorkspaceRoot !== workspaceRootStr) {
		_cachedSchemas = undefined;
		_cachedWorkspaceRoot = workspaceRootStr;
	}

	// Return cached result if available
	if (_cachedSchemas !== undefined) {
		return _cachedSchemas;
	}

	const csConfig = getContentstackConfig();

	if (!csConfig.enabled) {
		_cachedSchemas = null;
		return null;
	}

	try {
		if (csConfig.schemaSource === 'api') {
			_cachedSchemas = await _fetchFromAPI(csConfig, outputChannel);
		} else {
			_cachedSchemas = await _loadFromLocalFile(csConfig, workspaceRoot, outputChannel);
		}

		if (_cachedSchemas) {
			outputChannel?.appendLine(
				`[Contentstack] Loaded ${_cachedSchemas.length} content type schema(s) from ${csConfig.schemaSource}`
			);
		}

		return _cachedSchemas;
	} catch (err: any) {
		const msg = `Contentstack schemas could not be loaded: ${err?.message ?? String(err)}`;
		outputChannel?.appendLine(`[Contentstack] Warning: ${msg}`);
		_cachedSchemas = null;
		return null;
	}
}

/**
 * Clears the in-memory schema cache so the next call to
 * {@link loadContentstackSchemas} re-fetches from the configured source.
 */
export function clearSchemaCache(): void {
	_cachedSchemas = undefined;
}

// ---------------------------------------------------------------------------
// Fetch from Contentstack Management API
// ---------------------------------------------------------------------------

/**
 * Fetches all Content Type schemas from the Contentstack Management API.
 *
 * @see https://www.contentstack.com/docs/developers/apis/content-management-api/#get-all-content-types
 */
async function _fetchFromAPI(
	csConfig: ContentstackConfig,
	outputChannel?: vscode.OutputChannel,
): Promise<ContentTypeSchema[] | null> {
	if (!csConfig.apiKey || !csConfig.managementToken) {
		const msg = 'Contentstack API key and Management Token are required when schemaSource is "api". '
			+ 'Set them in ollama-code-review.contentstack settings.';
		outputChannel?.appendLine(`[Contentstack] ${msg}`);
		vscode.window.showWarningMessage(`Ollama Code Review: ${msg}`);
		return null;
	}

	const baseUrl = csConfig.apiHost.replace(/\/+$/, '');
	const url = `${baseUrl}/v3/content_types`;

	outputChannel?.appendLine(`[Contentstack] Fetching content types from ${url}`);

	const response = await axios.get(url, {
		headers: {
			'api_key': csConfig.apiKey,
			'authorization': csConfig.managementToken,
			'Content-Type': 'application/json',
		},
		params: {
			include_count: true,
		},
		timeout: 15_000,
	});

	const contentTypes = response.data?.content_types;
	if (!Array.isArray(contentTypes)) {
		outputChannel?.appendLine('[Contentstack] Unexpected API response: content_types is not an array');
		return null;
	}

	return contentTypes.map((ct: any) => ({
		uid: ct.uid,
		title: ct.title,
		schema: ct.schema ?? [],
		updated_at: ct.updated_at,
	}));
}

// ---------------------------------------------------------------------------
// Load from local JSON export
// ---------------------------------------------------------------------------

/**
 * Reads Content Type schemas from a local JSON file.
 *
 * Supports two formats:
 * 1. Contentstack export format: `{ "content_types": [...] }`
 * 2. Plain array format: `[{ "uid": "...", "schema": [...] }, ...]`
 */
async function _loadFromLocalFile(
	csConfig: ContentstackConfig,
	workspaceRoot: vscode.Uri,
	outputChannel?: vscode.OutputChannel,
): Promise<ContentTypeSchema[] | null> {
	const filePath = csConfig.localSchemaPath || DEFAULT_LOCAL_PATH;
	const fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);

	try {
		const fileBytes = await vscode.workspace.fs.readFile(fileUri);
		const jsonContent = Buffer.from(fileBytes).toString('utf-8');
		const parsed = JSON.parse(jsonContent);

		// Format 1: { "content_types": [...] }
		if (parsed && Array.isArray(parsed.content_types)) {
			return _normalizeSchemas(parsed.content_types);
		}

		// Format 2: plain array
		if (Array.isArray(parsed)) {
			return _normalizeSchemas(parsed);
		}

		outputChannel?.appendLine(
			`[Contentstack] ${filePath} must contain a "content_types" array or be a plain array of content types.`
		);
		return null;
	} catch (err: any) {
		if (err?.code === 'FileNotFound' || err?.name === 'EntryNotFound') {
			outputChannel?.appendLine(
				`[Contentstack] Local schema file not found: ${filePath}. Contentstack validation disabled.`
			);
			return null;
		}
		throw err;
	}
}

/** Normalizes raw JSON objects into strongly-typed ContentTypeSchema entries. */
function _normalizeSchemas(raw: any[]): ContentTypeSchema[] {
	return raw
		.filter((ct) => ct && typeof ct.uid === 'string' && Array.isArray(ct.schema))
		.map((ct) => ({
			uid: ct.uid,
			title: ct.title ?? ct.uid,
			schema: ct.schema,
			updated_at: ct.updated_at,
		}));
}

// ---------------------------------------------------------------------------
// Schema introspection helpers
// ---------------------------------------------------------------------------

/**
 * Collects all field UIDs from a content type schema, including nested
 * fields inside groups and modular blocks. Returns a flat set of UIDs.
 */
export function collectFieldUids(schema: ContentTypeSchema): Set<string> {
	const uids = new Set<string>();
	_walkFields(schema.schema, uids);
	return uids;
}

function _walkFields(fields: any[], uids: Set<string>): void {
	for (const field of fields) {
		if (field.uid) {
			uids.add(field.uid);
		}
		// Recurse into group and global field children
		if (Array.isArray(field.schema)) {
			_walkFields(field.schema, uids);
		}
		// Recurse into modular block options
		if (Array.isArray(field.blocks)) {
			for (const block of field.blocks) {
				if (block.uid) { uids.add(block.uid); }
				if (Array.isArray(block.schema)) {
					_walkFields(block.schema, uids);
				}
			}
		}
	}
}

/**
 * Builds a flat map of `fieldUid → displayName` for a content type,
 * including nested fields with dot-delimited paths.
 */
export function buildFieldMap(schema: ContentTypeSchema): Map<string, string> {
	const map = new Map<string, string>();
	_walkFieldMap(schema.schema, '', map);
	return map;
}

function _walkFieldMap(fields: any[], prefix: string, map: Map<string, string>): void {
	for (const field of fields) {
		if (!field.uid) { continue; }
		const key = prefix ? `${prefix}.${field.uid}` : field.uid;
		map.set(key, field.display_name ?? field.uid);

		// Also register the bare uid (without prefix) for simple access patterns
		if (prefix) {
			map.set(field.uid, field.display_name ?? field.uid);
		}

		if (Array.isArray(field.schema)) {
			_walkFieldMap(field.schema, key, map);
		}
		if (Array.isArray(field.blocks)) {
			for (const block of field.blocks) {
				if (block.uid) {
					const blockKey = `${key}.${block.uid}`;
					map.set(blockKey, block.title ?? block.uid);
					map.set(block.uid, block.title ?? block.uid);
					if (Array.isArray(block.schema)) {
						_walkFieldMap(block.schema, blockKey, map);
					}
				}
			}
		}
	}
}
