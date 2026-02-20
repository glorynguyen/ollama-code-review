import * as vscode from 'vscode';
import axios from 'axios';
import { getGitLabAuth, showGitLabAuthSetupGuide, GitLabAuth } from './auth';

/**
 * Parsed MR reference from user input
 */
export interface MRReference {
	projectPath: string; // e.g. "owner/repo" or "group/subgroup/project"
	mrNumber: number;
}

/**
 * MR metadata fetched from GitLab
 */
export interface MRInfo {
	title: string;
	description: string | null;
	state: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	webUrl: string;
	changedFiles: number;
	additions: number;
	deletions: number;
}

/**
 * Parse an MR URL or shorthand reference into an MRReference.
 *
 * Supported formats:
 *   - https://gitlab.com/owner/repo/-/merge_requests/123
 *   - https://gitlab.example.com/group/subgroup/project/-/merge_requests/456
 *   - owner/repo!123
 *   - !123 (requires projectContext)
 */
export function parseMRInput(input: string, projectContext?: string): MRReference | null {
	input = input.trim();

	// Full GitLab URL: https://gitlab.com/owner/repo/-/merge_requests/123
	const urlMatch = input.match(/(?:https?:\/\/[^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/);
	if (urlMatch) {
		return { projectPath: urlMatch[1], mrNumber: parseInt(urlMatch[2], 10) };
	}

	// Shorthand: owner/repo!123 or group/subgroup/project!123
	const shortMatch = input.match(/^(.+?)!(\d+)$/);
	if (shortMatch && shortMatch[1].includes('/')) {
		return { projectPath: shortMatch[1], mrNumber: parseInt(shortMatch[2], 10) };
	}

	// Just a number: !123 or 123
	const numMatch = input.match(/^!?(\d+)$/);
	if (numMatch && projectContext) {
		return { projectPath: projectContext, mrNumber: parseInt(numMatch[1], 10) };
	}

	return null;
}

/**
 * Detect the GitLab project path from a local git remote URL.
 */
export function parseGitLabRemoteUrl(remoteUrl: string): string | null {
	// SSH: git@gitlab.com:owner/repo.git
	const sshMatch = remoteUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return sshMatch[1];
	}

	// HTTPS: https://gitlab.com/owner/repo.git
	const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return httpsMatch[1];
	}

	return null;
}

/**
 * Check if a remote URL is for GitLab (not GitHub or Bitbucket).
 */
export function isGitLabRemote(remoteUrl: string): boolean {
	return /gitlab/i.test(remoteUrl) && !/(github|bitbucket)/i.test(remoteUrl);
}

/**
 * Encode the project path for the GitLab API (replace / with %2F).
 */
function encodeProjectPath(projectPath: string): string {
	return encodeURIComponent(projectPath);
}

/**
 * Fetch MR diff from GitLab API.
 * Returns the unified diff as a string.
 */
export async function fetchMRDiff(ref: MRReference, auth: GitLabAuth): Promise<string> {
	const encodedProject = encodeProjectPath(ref.projectPath);

	// Get the MR changes (diffs)
	const response = await axios.get(
		`${auth.baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${ref.mrNumber}/changes`,
		{
			headers: { 'PRIVATE-TOKEN': auth.token },
			timeout: 30000
		}
	);

	const changes = response.data.changes || [];

	// Convert GitLab's change objects to unified diff format
	let diff = '';
	for (const change of changes) {
		diff += `diff --git a/${change.old_path} b/${change.new_path}\n`;
		if (change.new_file) {
			diff += `new file mode 100644\n`;
		} else if (change.deleted_file) {
			diff += `deleted file mode 100644\n`;
		} else if (change.renamed_file) {
			diff += `rename from ${change.old_path}\n`;
			diff += `rename to ${change.new_path}\n`;
		}
		diff += `--- ${change.new_file ? '/dev/null' : 'a/' + change.old_path}\n`;
		diff += `+++ ${change.deleted_file ? '/dev/null' : 'b/' + change.new_path}\n`;
		if (change.diff) {
			diff += change.diff;
			if (!change.diff.endsWith('\n')) {
				diff += '\n';
			}
		}
	}

	return diff;
}

/**
 * Fetch MR metadata from GitLab API.
 */
export async function fetchMRInfo(ref: MRReference, auth: GitLabAuth): Promise<MRInfo> {
	const encodedProject = encodeProjectPath(ref.projectPath);

	const response = await axios.get(
		`${auth.baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${ref.mrNumber}`,
		{
			headers: { 'PRIVATE-TOKEN': auth.token },
			timeout: 15000
		}
	);

	const data = response.data;

	// Fetch diff stats separately for additions/deletions
	let additions = 0;
	let deletions = 0;
	let changedFiles = 0;
	try {
		const diffStats = await axios.get(
			`${auth.baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${ref.mrNumber}/changes`,
			{
				headers: { 'PRIVATE-TOKEN': auth.token },
				timeout: 15000
			}
		);
		const changes = diffStats.data.changes || [];
		changedFiles = changes.length;
		for (const change of changes) {
			// Count additions and deletions from the diff
			if (change.diff) {
				for (const line of change.diff.split('\n')) {
					if (line.startsWith('+') && !line.startsWith('+++')) { additions++; }
					if (line.startsWith('-') && !line.startsWith('---')) { deletions++; }
				}
			}
		}
	} catch {
		// Non-fatal: stats are optional
	}

	return {
		title: data.title,
		description: data.description,
		state: data.state,
		author: data.author?.username || 'unknown',
		sourceBranch: data.source_branch,
		targetBranch: data.target_branch,
		webUrl: data.web_url,
		changedFiles,
		additions,
		deletions
	};
}

/**
 * Post a note (comment) to a GitLab MR.
 */
export async function postMRComment(
	ref: MRReference,
	auth: GitLabAuth,
	content: string,
	model: string
): Promise<string> {
	const encodedProject = encodeProjectPath(ref.projectPath);
	const timestamp = new Date().toLocaleDateString();
	const body = `## AI Code Review\n\n` +
		`> Generated on ${timestamp} by [Ollama Code Review](https://github.com/glorynguyen/ollama-code-review) using \`${model}\`\n\n---\n\n${content}`;

	const response = await axios.post(
		`${auth.baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${ref.mrNumber}/notes`,
		{ body },
		{
			headers: { 'PRIVATE-TOKEN': auth.token },
			timeout: 15000
		}
	);

	// GitLab doesn't return a direct URL for the note; construct it
	const noteId = response.data.id;
	return `${auth.baseUrl}/${ref.projectPath}/-/merge_requests/${ref.mrNumber}#note_${noteId}`;
}

/**
 * List open MRs for a given GitLab project.
 */
export async function listOpenMRs(
	projectPath: string,
	auth: GitLabAuth
): Promise<Array<{ iid: number; title: string; author: string; sourceBranch: string }>> {
	const encodedProject = encodeProjectPath(projectPath);

	const response = await axios.get(
		`${auth.baseUrl}/api/v4/projects/${encodedProject}/merge_requests`,
		{
			params: { state: 'opened', order_by: 'updated_at', sort: 'desc', per_page: 30 },
			headers: { 'PRIVATE-TOKEN': auth.token },
			timeout: 15000
		}
	);

	return response.data.map((mr: any) => ({
		iid: mr.iid,
		title: mr.title,
		author: mr.author?.username || 'unknown',
		sourceBranch: mr.source_branch
	}));
}

/**
 * Orchestrate the full "Review GitLab MR" flow.
 */
export async function promptAndFetchMR(
	repoPath: string,
	runGitCommand: (repoPath: string, args: string[]) => Promise<string>
): Promise<{ diff: string; ref: MRReference; info: MRInfo; auth: GitLabAuth } | null> {
	// 1. Authenticate
	const auth = await getGitLabAuth(true);
	if (!auth) {
		return null;
	}

	// 2. Detect project context from git remote
	let projectContext: string | null = null;
	try {
		const remoteUrl = await runGitCommand(repoPath, ['config', '--get', 'remote.origin.url']);
		if (isGitLabRemote(remoteUrl)) {
			projectContext = parseGitLabRemoteUrl(remoteUrl.trim());
		}
	} catch {
		// Not in a git repo with an origin, that's fine
	}

	// 3. Ask user for MR reference
	let mrRef: MRReference | null = null;

	// If we have project context, offer to pick from open MRs
	if (projectContext) {
		const inputMethod = await vscode.window.showQuickPick(
			[
				{ label: '$(list-unordered) Select from open MRs', description: projectContext, method: 'pick' as const },
				{ label: '$(edit) Enter MR URL or number', description: 'Any GitLab project', method: 'input' as const }
			],
			{ placeHolder: 'How would you like to select a Merge Request?' }
		);

		if (!inputMethod) { return null; }

		if (inputMethod.method === 'pick') {
			try {
				const mrs = await listOpenMRs(projectContext, auth);

				if (mrs.length === 0) {
					vscode.window.showInformationMessage('No open MRs found in this project.');
					return null;
				}

				const selected = await vscode.window.showQuickPick(
					mrs.map(mr => ({
						label: `!${mr.iid} ${mr.title}`,
						description: `${mr.sourceBranch} by ${mr.author}`,
						mrNumber: mr.iid
					})),
					{ placeHolder: 'Select an MR to review' }
				);

				if (!selected) { return null; }
				mrRef = { projectPath: projectContext, mrNumber: selected.mrNumber };
			} catch (error: any) {
				vscode.window.showWarningMessage(`Failed to list MRs: ${error.message || 'Unknown error'}. You can enter the MR URL manually.`);
			}
		}
	}

	// Manual input if no MR selected yet
	if (!mrRef) {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter MR URL or reference',
			placeHolder: projectContext
				? 'e.g., !123, owner/repo!123, or https://gitlab.com/owner/repo/-/merge_requests/123'
				: 'e.g., owner/repo!123 or https://gitlab.com/owner/repo/-/merge_requests/123',
			validateInput: (value: string) => {
				if (!value || !value.trim()) { return 'Please enter an MR reference'; }
				const parsed = parseMRInput(value, projectContext || undefined);
				return parsed ? undefined : 'Invalid format. Use: !123, owner/repo!123, or a full GitLab MR URL';
			}
		});

		if (!input) { return null; }
		mrRef = parseMRInput(input, projectContext || undefined);
	}

	if (!mrRef) { return null; }

	// 4. Fetch MR info and diff
	const [info, diff] = await Promise.all([
		fetchMRInfo(mrRef, auth),
		fetchMRDiff(mrRef, auth)
	]);

	return { diff, ref: mrRef, info, auth };
}
