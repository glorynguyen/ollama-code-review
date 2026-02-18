import * as vscode from 'vscode';
import { exec } from 'child_process';

/**
 * GitHub authentication result
 */
export interface GitHubAuth {
	token: string;
	source: 'gh-cli' | 'vscode-session' | 'settings';
}

/**
 * Try to get a GitHub token from the `gh` CLI.
 * Returns null if `gh` is not installed or not authenticated.
 */
function tryGetGhCliToken(): Promise<string | null> {
	return new Promise((resolve) => {
		exec('gh auth token', { timeout: 5000 }, (error, stdout) => {
			if (error || !stdout.trim()) {
				resolve(null);
			} else {
				resolve(stdout.trim());
			}
		});
	});
}

/**
 * Try to get a GitHub token from VS Code's built-in authentication provider.
 * Requires the user to have signed in to GitHub via VS Code.
 * When `createIfNone` is true, the user will be prompted to sign in.
 */
async function tryGetVSCodeSession(createIfNone: boolean): Promise<string | null> {
	try {
		const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone });
		return session?.accessToken ?? null;
	} catch {
		return null;
	}
}

/**
 * Get a GitHub token from the extension's settings.
 */
function getSettingsToken(): string | null {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	// Check PR-specific token first, then fall back to gist token (both have repo access potentially)
	const prToken = config.get<string>('github.token', '');
	if (prToken) { return prToken; }
	const gistToken = config.get<string>('github.gistToken', '');
	return gistToken || null;
}

/**
 * Attempt to authenticate with GitHub using multiple strategies.
 * Priority: gh CLI → VS Code session → stored token in settings
 * Returns null if no authentication is available.
 */
export async function getGitHubAuth(promptIfNeeded = false): Promise<GitHubAuth | null> {
	// 1. Try gh CLI first (best UX, already authenticated)
	const ghToken = await tryGetGhCliToken();
	if (ghToken) {
		return { token: ghToken, source: 'gh-cli' };
	}

	// 2. Try VS Code GitHub session (non-interactive first)
	const vsCodeToken = await tryGetVSCodeSession(false);
	if (vsCodeToken) {
		return { token: vsCodeToken, source: 'vscode-session' };
	}

	// 3. Try stored token from settings
	const settingsToken = getSettingsToken();
	if (settingsToken) {
		return { token: settingsToken, source: 'settings' };
	}

	// 4. If prompting is allowed, ask VS Code to create a session (shows login UI)
	if (promptIfNeeded) {
		const promptToken = await tryGetVSCodeSession(true);
		if (promptToken) {
			return { token: promptToken, source: 'vscode-session' };
		}
	}

	return null;
}

/**
 * Show an error message guiding the user to set up GitHub authentication.
 */
export async function showAuthSetupGuide(): Promise<void> {
	const action = await vscode.window.showErrorMessage(
		'GitHub authentication required. You can authenticate via:\n' +
		'1. GitHub CLI (`gh auth login`)\n' +
		'2. VS Code GitHub sign-in\n' +
		'3. Personal Access Token in settings',
		'Sign in via VS Code',
		'Open Settings'
	);

	if (action === 'Sign in via VS Code') {
		try {
			await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
		} catch {
			// User cancelled
		}
	} else if (action === 'Open Settings') {
		vscode.commands.executeCommand('workbench.action.openSettings', 'ollama-code-review.github.token');
	}
}
