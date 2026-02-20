import * as vscode from 'vscode';

/**
 * Bitbucket authentication result.
 * Uses App Passwords for Bitbucket Cloud API access.
 */
export interface BitbucketAuth {
	username: string;
	appPassword: string;
	source: 'settings';
}

/**
 * Get Bitbucket credentials from the extension's settings.
 */
function getSettingsAuth(): BitbucketAuth | null {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const username = config.get<string>('bitbucket.username', '');
	const appPassword = config.get<string>('bitbucket.appPassword', '');
	if (username && appPassword) {
		return { username, appPassword, source: 'settings' };
	}
	return null;
}

/**
 * Attempt to authenticate with Bitbucket.
 * Currently supports stored credentials in settings.
 */
export async function getBitbucketAuth(promptIfNeeded = false): Promise<BitbucketAuth | null> {
	// 1. Try stored credentials from settings
	const settingsAuth = getSettingsAuth();
	if (settingsAuth) {
		return settingsAuth;
	}

	// 2. Prompt user if needed
	if (promptIfNeeded) {
		await showBitbucketAuthSetupGuide();
	}

	return null;
}

/**
 * Build the Authorization header for Bitbucket Cloud API requests.
 * Uses HTTP Basic Auth with username:app-password.
 */
export function buildBitbucketAuthHeader(auth: BitbucketAuth): string {
	const encoded = Buffer.from(`${auth.username}:${auth.appPassword}`).toString('base64');
	return `Basic ${encoded}`;
}

/**
 * Show an error message guiding the user to set up Bitbucket authentication.
 */
export async function showBitbucketAuthSetupGuide(): Promise<void> {
	const action = await vscode.window.showErrorMessage(
		'Bitbucket authentication required. You need:\n' +
		'1. Your Bitbucket username\n' +
		'2. An App Password with "Pull requests: Read/Write" scope\n\n' +
		'Create an App Password at: Bitbucket > Settings > App Passwords',
		'Open Settings'
	);

	if (action === 'Open Settings') {
		vscode.commands.executeCommand('workbench.action.openSettings', 'ollama-code-review.bitbucket');
	}
}
