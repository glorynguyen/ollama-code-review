import * as vscode from 'vscode';
import { exec } from 'child_process';

/**
 * GitLab authentication result
 */
export interface GitLabAuth {
	token: string;
	baseUrl: string;
	source: 'glab-cli' | 'settings';
}

/**
 * Try to get a GitLab token from the `glab` CLI.
 * Returns null if `glab` is not installed or not authenticated.
 */
function tryGetGlabCliToken(): Promise<{ token: string; host: string } | null> {
	return new Promise((resolve) => {
		exec('glab auth status -t 2>&1', { timeout: 5000 }, (error: Error | null, stdout: string, stderr: string) => {
			const output = (stdout || '') + (stderr || '');
			// glab outputs: Token: glpat-XXXX
			const tokenMatch = output.match(/Token:\s+(glpat-[^\s]+|[a-zA-Z0-9_-]{20,})/);
			const hostMatch = output.match(/Logged in to\s+([\w.-]+)/);
			if (tokenMatch) {
				resolve({
					token: tokenMatch[1],
					host: hostMatch ? hostMatch[1] : 'gitlab.com'
				});
			} else {
				resolve(null);
			}
		});
	});
}

/**
 * Get a GitLab token from the extension's settings.
 */
function getSettingsAuth(): { token: string; baseUrl: string } | null {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const token = config.get<string>('gitlab.token', '');
	const baseUrl = config.get<string>('gitlab.baseUrl', 'https://gitlab.com');
	if (token) {
		return { token, baseUrl };
	}
	return null;
}

/**
 * Attempt to authenticate with GitLab using multiple strategies.
 * Priority: glab CLI -> stored token in settings
 * Returns null if no authentication is available.
 */
export async function getGitLabAuth(promptIfNeeded = false): Promise<GitLabAuth | null> {
	// 1. Try glab CLI first
	const glabResult = await tryGetGlabCliToken();
	if (glabResult) {
		const baseUrl = glabResult.host === 'gitlab.com'
			? 'https://gitlab.com'
			: `https://${glabResult.host}`;
		return { token: glabResult.token, baseUrl, source: 'glab-cli' };
	}

	// 2. Try stored token from settings
	const settingsAuth = getSettingsAuth();
	if (settingsAuth) {
		return { token: settingsAuth.token, baseUrl: settingsAuth.baseUrl, source: 'settings' };
	}

	// 3. Prompt user if needed
	if (promptIfNeeded) {
		await showGitLabAuthSetupGuide();
	}

	return null;
}

/**
 * Show an error message guiding the user to set up GitLab authentication.
 */
export async function showGitLabAuthSetupGuide(): Promise<void> {
	const action = await vscode.window.showErrorMessage(
		'GitLab authentication required. You can authenticate via:\n' +
		'1. GitLab CLI (`glab auth login`)\n' +
		'2. Personal Access Token in settings',
		'Open Settings'
	);

	if (action === 'Open Settings') {
		vscode.commands.executeCommand('workbench.action.openSettings', 'ollama-code-review.gitlab.token');
	}
}
