import * as vscode from 'vscode';
import axios from 'axios';
import { getBitbucketAuth, showBitbucketAuthSetupGuide, BitbucketAuth, buildBitbucketAuthHeader } from './auth';

const BITBUCKET_API = 'https://api.bitbucket.org/2.0';

/**
 * Parsed Bitbucket PR reference from user input
 */
export interface BitbucketPRReference {
	workspace: string;
	repoSlug: string;
	prId: number;
}

/**
 * PR metadata fetched from Bitbucket
 */
export interface BitbucketPRInfo {
	title: string;
	description: string | null;
	state: string;
	author: string;
	sourceBranch: string;
	destinationBranch: string;
	webUrl: string;
	taskCount: number;
}

/**
 * Parse a Bitbucket PR URL or shorthand reference.
 *
 * Supported formats:
 *   - https://bitbucket.org/workspace/repo/pull-requests/123
 *   - workspace/repo#123
 *   - #123 (requires repoContext)
 */
export function parseBitbucketPRInput(
	input: string,
	repoContext?: { workspace: string; repoSlug: string }
): BitbucketPRReference | null {
	input = input.trim();

	// Full Bitbucket URL: https://bitbucket.org/workspace/repo/pull-requests/123
	const urlMatch = input.match(/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/);
	if (urlMatch) {
		return { workspace: urlMatch[1], repoSlug: urlMatch[2], prId: parseInt(urlMatch[3], 10) };
	}

	// Shorthand: workspace/repo#123
	const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
	if (shortMatch) {
		return { workspace: shortMatch[1], repoSlug: shortMatch[2], prId: parseInt(shortMatch[3], 10) };
	}

	// Just a number: #123 or 123
	const numMatch = input.match(/^#?(\d+)$/);
	if (numMatch && repoContext) {
		return { workspace: repoContext.workspace, repoSlug: repoContext.repoSlug, prId: parseInt(numMatch[1], 10) };
	}

	return null;
}

/**
 * Detect the Bitbucket workspace/repo from a local git remote URL.
 */
export function parseBitbucketRemoteUrl(remoteUrl: string): { workspace: string; repoSlug: string } | null {
	// SSH: git@bitbucket.org:workspace/repo.git
	const sshMatch = remoteUrl.match(/git@bitbucket\.org:([^/]+)\/(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return { workspace: sshMatch[1], repoSlug: sshMatch[2] };
	}

	// HTTPS: https://bitbucket.org/workspace/repo.git
	// Also: https://user@bitbucket.org/workspace/repo.git
	const httpsMatch = remoteUrl.match(/bitbucket\.org\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return { workspace: httpsMatch[1], repoSlug: httpsMatch[2] };
	}

	return null;
}

/**
 * Check if a remote URL is for Bitbucket.
 */
export function isBitbucketRemote(remoteUrl: string): boolean {
	return /bitbucket/i.test(remoteUrl) && !/(github|gitlab)/i.test(remoteUrl);
}

/**
 * Fetch PR diff from Bitbucket API.
 * Returns the unified diff as a string.
 */
export async function fetchBitbucketPRDiff(ref: BitbucketPRReference, auth: BitbucketAuth): Promise<string> {
	const response = await axios.get(
		`${BITBUCKET_API}/repositories/${ref.workspace}/${ref.repoSlug}/pullrequests/${ref.prId}/diff`,
		{
			headers: {
				'Authorization': buildBitbucketAuthHeader(auth),
				'Accept': 'text/plain'
			},
			timeout: 30000,
			responseType: 'text'
		}
	);

	return response.data;
}

/**
 * Fetch PR metadata from Bitbucket API.
 */
export async function fetchBitbucketPRInfo(ref: BitbucketPRReference, auth: BitbucketAuth): Promise<BitbucketPRInfo> {
	const response = await axios.get(
		`${BITBUCKET_API}/repositories/${ref.workspace}/${ref.repoSlug}/pullrequests/${ref.prId}`,
		{
			headers: {
				'Authorization': buildBitbucketAuthHeader(auth)
			},
			timeout: 15000
		}
	);

	const data = response.data;

	return {
		title: data.title,
		description: data.description || null,
		state: data.state,
		author: data.author?.display_name || data.author?.nickname || 'unknown',
		sourceBranch: data.source?.branch?.name || 'unknown',
		destinationBranch: data.destination?.branch?.name || 'unknown',
		webUrl: data.links?.html?.href || `https://bitbucket.org/${ref.workspace}/${ref.repoSlug}/pull-requests/${ref.prId}`,
		taskCount: data.task_count || 0
	};
}

/**
 * Post a comment to a Bitbucket PR.
 */
export async function postBitbucketPRComment(
	ref: BitbucketPRReference,
	auth: BitbucketAuth,
	content: string,
	model: string
): Promise<string> {
	const timestamp = new Date().toLocaleDateString();
	const body = `## AI Code Review\n\n` +
		`> Generated on ${timestamp} by [Ollama Code Review](https://github.com/glorynguyen/ollama-code-review) using \`${model}\`\n\n---\n\n${content}`;

	const response = await axios.post(
		`${BITBUCKET_API}/repositories/${ref.workspace}/${ref.repoSlug}/pullrequests/${ref.prId}/comments`,
		{
			content: { raw: body }
		},
		{
			headers: {
				'Authorization': buildBitbucketAuthHeader(auth),
				'Content-Type': 'application/json'
			},
			timeout: 15000
		}
	);

	const commentId = response.data.id;
	return `https://bitbucket.org/${ref.workspace}/${ref.repoSlug}/pull-requests/${ref.prId}#comment-${commentId}`;
}

/**
 * List open PRs for a given Bitbucket repository.
 */
export async function listOpenBitbucketPRs(
	workspace: string,
	repoSlug: string,
	auth: BitbucketAuth
): Promise<Array<{ id: number; title: string; author: string; sourceBranch: string }>> {
	const response = await axios.get(
		`${BITBUCKET_API}/repositories/${workspace}/${repoSlug}/pullrequests`,
		{
			params: { state: 'OPEN', pagelen: 30 },
			headers: {
				'Authorization': buildBitbucketAuthHeader(auth)
			},
			timeout: 15000
		}
	);

	return (response.data.values || []).map((pr: any) => ({
		id: pr.id,
		title: pr.title,
		author: pr.author?.display_name || pr.author?.nickname || 'unknown',
		sourceBranch: pr.source?.branch?.name || 'unknown'
	}));
}

/**
 * Orchestrate the full "Review Bitbucket PR" flow.
 */
export async function promptAndFetchBitbucketPR(
	repoPath: string,
	runGitCommand: (repoPath: string, args: string[]) => Promise<string>
): Promise<{ diff: string; ref: BitbucketPRReference; info: BitbucketPRInfo; auth: BitbucketAuth } | null> {
	// 1. Authenticate
	const auth = await getBitbucketAuth(true);
	if (!auth) {
		return null;
	}

	// 2. Detect repo context from git remote
	let repoContext: { workspace: string; repoSlug: string } | null = null;
	try {
		const remoteUrl = await runGitCommand(repoPath, ['config', '--get', 'remote.origin.url']);
		if (isBitbucketRemote(remoteUrl)) {
			repoContext = parseBitbucketRemoteUrl(remoteUrl.trim());
		}
	} catch {
		// Not in a git repo with an origin, that's fine
	}

	// 3. Ask user for PR reference
	let prRef: BitbucketPRReference | null = null;

	// If we have repo context, offer to pick from open PRs
	if (repoContext) {
		const inputMethod = await vscode.window.showQuickPick(
			[
				{ label: '$(list-unordered) Select from open PRs', description: `${repoContext.workspace}/${repoContext.repoSlug}`, method: 'pick' as const },
				{ label: '$(edit) Enter PR URL or number', description: 'Any Bitbucket repository', method: 'input' as const }
			],
			{ placeHolder: 'How would you like to select a Pull Request?' }
		);

		if (!inputMethod) { return null; }

		if (inputMethod.method === 'pick') {
			try {
				const prs = await listOpenBitbucketPRs(repoContext.workspace, repoContext.repoSlug, auth);

				if (prs.length === 0) {
					vscode.window.showInformationMessage('No open PRs found in this repository.');
					return null;
				}

				const selected = await vscode.window.showQuickPick(
					prs.map(pr => ({
						label: `#${pr.id} ${pr.title}`,
						description: `${pr.sourceBranch} by ${pr.author}`,
						prId: pr.id
					})),
					{ placeHolder: 'Select a PR to review' }
				);

				if (!selected) { return null; }
				prRef = { workspace: repoContext.workspace, repoSlug: repoContext.repoSlug, prId: selected.prId };
			} catch (error: any) {
				vscode.window.showWarningMessage(`Failed to list PRs: ${error.message || 'Unknown error'}. You can enter the PR URL manually.`);
			}
		}
	}

	// Manual input if no PR selected yet
	if (!prRef) {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter Bitbucket PR URL or reference',
			placeHolder: repoContext
				? 'e.g., #123, workspace/repo#123, or https://bitbucket.org/workspace/repo/pull-requests/123'
				: 'e.g., workspace/repo#123 or https://bitbucket.org/workspace/repo/pull-requests/123',
			validateInput: (value: string) => {
				if (!value || !value.trim()) { return 'Please enter a PR reference'; }
				const parsed = parseBitbucketPRInput(value, repoContext || undefined);
				return parsed ? undefined : 'Invalid format. Use: #123, workspace/repo#123, or a full Bitbucket PR URL';
			}
		});

		if (!input) { return null; }
		prRef = parseBitbucketPRInput(input, repoContext || undefined);
	}

	if (!prRef) { return null; }

	// 4. Fetch PR info and diff
	const [info, diff] = await Promise.all([
		fetchBitbucketPRInfo(prRef, auth),
		fetchBitbucketPRDiff(prRef, auth)
	]);

	return { diff, ref: prRef, info, auth };
}
