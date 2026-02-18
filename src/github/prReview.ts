import * as vscode from 'vscode';
import { getGitHubAuth, showAuthSetupGuide, GitHubAuth } from './auth';
import { ReviewFinding, formatFindingAsComment, formatFindingsAsSummary } from './commentMapper';

/**
 * Parsed PR reference from user input
 */
export interface PRReference {
	owner: string;
	repo: string;
	prNumber: number;
}

/**
 * PR metadata fetched from GitHub
 */
export interface PRInfo {
	title: string;
	body: string | null;
	state: string;
	user: string;
	baseBranch: string;
	headBranch: string;
	url: string;
	changedFiles: number;
	additions: number;
	deletions: number;
}

/**
 * Parse a PR URL or shorthand reference into a PRReference.
 *
 * Supported formats:
 *   - https://github.com/owner/repo/pull/123
 *   - owner/repo#123
 *   - #123 (requires repoContext)
 */
export function parsePRInput(input: string, repoContext?: { owner: string; repo: string }): PRReference | null {
	input = input.trim();

	// Full GitHub URL: https://github.com/owner/repo/pull/123
	const urlMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
	if (urlMatch) {
		return { owner: urlMatch[1], repo: urlMatch[2], prNumber: parseInt(urlMatch[3], 10) };
	}

	// Shorthand: owner/repo#123
	const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
	if (shortMatch) {
		return { owner: shortMatch[1], repo: shortMatch[2], prNumber: parseInt(shortMatch[3], 10) };
	}

	// Just a number: #123 or 123
	const numMatch = input.match(/^#?(\d+)$/);
	if (numMatch && repoContext) {
		return { owner: repoContext.owner, repo: repoContext.repo, prNumber: parseInt(numMatch[1], 10) };
	}

	return null;
}

/**
 * Detect the GitHub remote owner/repo from a local git repository.
 * Reads the `origin` remote URL and parses owner/repo from it.
 */
export function parseRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
	// SSH: git@github.com:owner/repo.git
	const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return { owner: sshMatch[1], repo: sshMatch[2] };
	}

	// HTTPS: https://github.com/owner/repo.git
	const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return { owner: httpsMatch[1], repo: httpsMatch[2] };
	}

	return null;
}

/**
 * Fetch PR diff from GitHub API.
 * Returns the unified diff as a string.
 */
export async function fetchPRDiff(ref: PRReference, auth: GitHubAuth): Promise<string> {
	const { Octokit } = await import('@octokit/rest');
	const octokit = new Octokit({ auth: auth.token });

	const response = await octokit.pulls.get({
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.prNumber,
		mediaType: { format: 'diff' }
	});

	// When requesting diff format, the response data is a string
	return response.data as unknown as string;
}

/**
 * Fetch PR metadata from GitHub API.
 */
export async function fetchPRInfo(ref: PRReference, auth: GitHubAuth): Promise<PRInfo> {
	const { Octokit } = await import('@octokit/rest');
	const octokit = new Octokit({ auth: auth.token });

	const { data } = await octokit.pulls.get({
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.prNumber
	});

	return {
		title: data.title,
		body: data.body,
		state: data.state,
		user: data.user?.login || 'unknown',
		baseBranch: data.base.ref,
		headBranch: data.head.ref,
		url: data.html_url,
		changedFiles: data.changed_files,
		additions: data.additions,
		deletions: data.deletions
	};
}

/**
 * Post a summary comment to a GitHub PR.
 */
export async function postPRSummaryComment(
	ref: PRReference,
	auth: GitHubAuth,
	reviewContent: string,
	model: string
): Promise<string> {
	const { Octokit } = await import('@octokit/rest');
	const octokit = new Octokit({ auth: auth.token });

	const timestamp = new Date().toLocaleDateString();
	const body = `## 🔍 AI Code Review\n\n` +
		`> Generated on ${timestamp} by [Ollama Code Review](https://github.com/glorynguyen/ollama-code-review) using \`${model}\`\n\n---\n\n${reviewContent}`;

	const { data } = await octokit.issues.createComment({
		owner: ref.owner,
		repo: ref.repo,
		issue_number: ref.prNumber,
		body
	});

	return data.html_url;
}

/**
 * Post a full GitHub PR review with inline comments.
 * This creates a proper "review" (not just issue comments) with
 * file-specific inline comments plus a summary body.
 */
export async function postPRReview(
	ref: PRReference,
	auth: GitHubAuth,
	findings: ReviewFinding[],
	reviewContent: string,
	model: string
): Promise<string> {
	const { Octokit } = await import('@octokit/rest');
	const octokit = new Octokit({ auth: auth.token });

	// Get the PR's head SHA (required for review API)
	const { data: pr } = await octokit.pulls.get({
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.prNumber
	});
	const commitId = pr.head.sha;

	// Build inline comments for findings that have file + line info
	const comments: Array<{ path: string; line: number; body: string }> = [];
	for (const finding of findings) {
		if (finding.file && finding.line) {
			comments.push({
				path: finding.file,
				line: finding.line,
				body: formatFindingAsComment(finding)
			});
		}
	}

	// Build the summary body
	const summaryBody = formatFindingsAsSummary(findings, model);
	const fullBody = summaryBody + '\n\n---\n\n' + reviewContent;

	// Determine review event based on findings
	const hasCritical = findings.some(f => f.severity === 'critical');
	const event: 'COMMENT' | 'REQUEST_CHANGES' = hasCritical ? 'REQUEST_CHANGES' : 'COMMENT';

	const { data: review } = await octokit.pulls.createReview({
		owner: ref.owner,
		repo: ref.repo,
		pull_number: ref.prNumber,
		commit_id: commitId,
		body: fullBody,
		event,
		comments: comments.length > 0 ? comments : undefined
	});

	return review.html_url;
}

/**
 * List open PRs for a given repository.
 * Returns a simplified list for QuickPick display.
 */
export async function listOpenPRs(
	owner: string,
	repo: string,
	auth: GitHubAuth
): Promise<Array<{ number: number; title: string; user: string; headBranch: string }>> {
	const { Octokit } = await import('@octokit/rest');
	const octokit = new Octokit({ auth: auth.token });

	const { data } = await octokit.pulls.list({
		owner,
		repo,
		state: 'open',
		sort: 'updated',
		direction: 'desc',
		per_page: 30
	});

	return data.map(pr => ({
		number: pr.number,
		title: pr.title,
		user: pr.user?.login || 'unknown',
		headBranch: pr.head.ref
	}));
}

/**
 * Orchestrate the full "Review GitHub PR" flow.
 * Returns the PR diff for review or null if cancelled.
 */
export async function promptAndFetchPR(
	repoPath: string,
	runGitCommand: (repoPath: string, args: string[]) => Promise<string>
): Promise<{ diff: string; ref: PRReference; info: PRInfo; auth: GitHubAuth } | null> {
	// 1. Authenticate
	const auth = await getGitHubAuth(true);
	if (!auth) {
		await showAuthSetupGuide();
		return null;
	}

	// 2. Detect repo context from git remote
	let repoContext: { owner: string; repo: string } | null = null;
	try {
		const remoteUrl = await runGitCommand(repoPath, ['config', '--get', 'remote.origin.url']);
		repoContext = parseRemoteUrl(remoteUrl.trim());
	} catch {
		// Not in a git repo with an origin, that's fine
	}

	// 3. Ask user for PR reference
	let prRef: PRReference | null = null;

	// If we have repo context, offer to pick from open PRs
	if (repoContext) {
		const inputMethod = await vscode.window.showQuickPick(
			[
				{ label: '$(list-unordered) Select from open PRs', description: `${repoContext.owner}/${repoContext.repo}`, method: 'pick' },
				{ label: '$(edit) Enter PR URL or number', description: 'Any GitHub repository', method: 'input' }
			],
			{ placeHolder: 'How would you like to select a PR?' }
		);

		if (!inputMethod) { return null; }

		if (inputMethod.method === 'pick') {
			const prs = await listOpenPRs(repoContext.owner, repoContext.repo, auth);

			if (prs.length === 0) {
				vscode.window.showInformationMessage('No open PRs found in this repository.');
				return null;
			}

			const selected = await vscode.window.showQuickPick(
				prs.map(pr => ({
					label: `#${pr.number} ${pr.title}`,
					description: `${pr.headBranch} by ${pr.user}`,
					prNumber: pr.number
				})),
				{ placeHolder: 'Select a PR to review' }
			);

			if (!selected) { return null; }
			prRef = { owner: repoContext.owner, repo: repoContext.repo, prNumber: selected.prNumber };
		}
	}

	// Manual input if no PR selected yet
	if (!prRef) {
		const input = await vscode.window.showInputBox({
			prompt: 'Enter PR URL or reference',
			placeHolder: repoContext
				? 'e.g., #123, owner/repo#123, or https://github.com/owner/repo/pull/123'
				: 'e.g., owner/repo#123 or https://github.com/owner/repo/pull/123',
			validateInput: (value) => {
				if (!value || !value.trim()) { return 'Please enter a PR reference'; }
				const parsed = parsePRInput(value, repoContext || undefined);
				return parsed ? undefined : 'Invalid format. Use: #123, owner/repo#123, or a full GitHub PR URL';
			}
		});

		if (!input) { return null; }
		prRef = parsePRInput(input, repoContext || undefined);
	}

	if (!prRef) { return null; }

	// 4. Fetch PR info and diff
	const [info, diff] = await Promise.all([
		fetchPRInfo(prRef, auth),
		fetchPRDiff(prRef, auth)
	]);

	return { diff, ref: prRef, info, auth };
}
