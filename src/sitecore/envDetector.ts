/**
 * F-050: Sitecore Layout Service Schema Validation — Environment Detector
 *
 * Reads .env.local / .env files to auto-detect Sitecore configuration
 * (API key, GraphQL endpoint, site name) for zero-config schema fetching.
 */
import * as vscode from 'vscode';
import type { SitecoreEnvConfig } from './types';

// ---------------------------------------------------------------------------
// Environment variable names to look for
// ---------------------------------------------------------------------------

const ENV_KEYS = {
	apiKey: ['SITECORE_API_KEY', 'SITECORE_EDGE_API_KEY', 'NEXT_PUBLIC_SITECORE_API_KEY'],
	graphqlEndpoint: ['GRAPH_QL_ENDPOINT', 'SITECORE_EDGE_URL', 'GRAPHQL_ENDPOINT', 'SITECORE_GRAPHQL_ENDPOINT'],
	siteName: ['SITECORE_SITE_NAME', 'NEXT_PUBLIC_SITECORE_SITE_NAME', 'JSS_APP_NAME'],
};

// Env files to check, in order (matching Next.js convention)
const ENV_FILE_PRIORITY = [
	'.env.local',
	'.env.development.local',
	'.env',
	'.env.development',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempts to detect Sitecore configuration from environment files.
 * Returns null if the required variables are not found.
 *
 * @param envFileName Optional override for which env file to read
 */
export async function detectSitecoreEnv(
	envFileName?: string,
): Promise<SitecoreEnvConfig | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return null;
	}

	const workspaceRoot = workspaceFolders[0].uri;

	// If a specific env file is specified, only check that one
	const filesToCheck = envFileName ? [envFileName] : ENV_FILE_PRIORITY;

	for (const fileName of filesToCheck) {
		const envUri = vscode.Uri.joinPath(workspaceRoot, fileName);
		const vars = await _readEnvFile(envUri);
		if (!vars) { continue; }

		const apiKey = _findVar(vars, ENV_KEYS.apiKey);
		const graphqlEndpoint = _findVar(vars, ENV_KEYS.graphqlEndpoint);
		const siteName = _findVar(vars, ENV_KEYS.siteName);

		// Need at least endpoint and API key
		if (apiKey && graphqlEndpoint) {
			return {
				apiKey,
				graphqlEndpoint,
				siteName: siteName || 'website', // default site name
			};
		}
	}

	return null;
}

/**
 * Returns which env file was found (for UI display purposes).
 */
export async function findEnvFile(): Promise<string | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return null;
	}

	const workspaceRoot = workspaceFolders[0].uri;

	for (const fileName of ENV_FILE_PRIORITY) {
		const envUri = vscode.Uri.joinPath(workspaceRoot, fileName);
		try {
			await vscode.workspace.fs.stat(envUri);
			return fileName;
		} catch {
			// File doesn't exist, try next
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads and parses an .env file into a key-value map.
 * Returns null if the file doesn't exist or can't be read.
 */
async function _readEnvFile(
	uri: vscode.Uri,
): Promise<Map<string, string> | null> {
	try {
		const content = await vscode.workspace.fs.readFile(uri);
		const text = Buffer.from(content).toString('utf8');
		return _parseEnvContent(text);
	} catch {
		return null;
	}
}

/**
 * Parses .env file content into a key-value map.
 * Handles:
 * - Comments (# ...)
 * - Quoted values (single and double quotes)
 * - Inline comments
 * - Empty lines
 */
function _parseEnvContent(content: string): Map<string, string> {
	const vars = new Map<string, string>();

	for (const line of content.split('\n')) {
		const trimmed = line.trim();

		// Skip empty lines and comments
		if (!trimmed || trimmed.startsWith('#')) { continue; }

		// Match KEY=VALUE pattern
		const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
		if (!match) { continue; }

		const key = match[1];
		let value = match[2].trim();

		// Remove surrounding quotes
		if ((value.startsWith('"') && value.endsWith('"'))
			|| (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		// Remove inline comments (only for unquoted values)
		const commentIdx = value.indexOf(' #');
		if (commentIdx > 0) {
			value = value.slice(0, commentIdx).trim();
		}

		vars.set(key, value);
	}

	return vars;
}

/**
 * Finds the first matching variable from a list of possible names.
 */
function _findVar(vars: Map<string, string>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = vars.get(key);
		if (value) { return value; }
	}
	return undefined;
}
