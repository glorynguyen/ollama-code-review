import { McpClient } from './mcpClient';
import type { BackgroundMessage, WorkspaceRepo } from './types';

const mcpClient = new McpClient('http://127.0.0.1:19840/mcp');

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
	void (async () => {
		if (message.type === 'SET_MCP_TOKEN') {
			await chrome.storage.local.set({ mcpToken: message.payload.token });
			sendResponse({ ok: true });
			return;
		}

		if (message.type === 'FETCH_PR_DIFF') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const repos = await mcpClient.getWorkspaceRepos();
			const repo = findMatchingRepo(
				repos,
				message.payload.host,
				message.payload.owner,
				message.payload.repo,
			);

			if (!repo) {
				sendResponse({
					ok: false,
					error: 'No open VS Code workspace matches this repository. Open the local repo in VS Code first.',
				});
				return;
			}

			const diff = await mcpClient.getBranchDiff({
				repository_path: repo.path,
				base_ref: message.payload.baseRef,
				target_ref: message.payload.headRef,
			});

			sendResponse({
				ok: true,
				data: {
					repositoryPath: repo.path,
					diff,
				},
			});
			return;
		}

		if (message.type === 'FETCH_STAGED_DIFF') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const repos = await mcpClient.getWorkspaceRepos();
			const repo = findRepoForStagedChanges(
				repos,
				message.payload.host,
				message.payload.owner,
				message.payload.repo,
			);

			if (!repo) {
				sendResponse({
					ok: false,
					error: 'Could not determine which local workspace repo to use for staged changes. Open the repo in VS Code, or keep only one matching repo open.',
				});
				return;
			}

			const diff = await mcpClient.getStagedDiff({
				repository_path: repo.path,
			});

			sendResponse({
				ok: true,
				data: {
					repositoryPath: repo.path,
					diff,
				},
			});
			return;
		}

		if (message.type === 'FETCH_STAGED_REVIEW_BUNDLE') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const repos = await mcpClient.getWorkspaceRepos();
			const repo = findRepoForStagedChanges(
				repos,
				message.payload.host,
				message.payload.owner,
				message.payload.repo,
			);

			if (!repo) {
				sendResponse({
					ok: false,
					error: 'Could not determine which local workspace repo to use for staged review. Open the repo in VS Code, or keep only one matching repo open.',
				});
				return;
			}

			const bundle = await mcpClient.getStagedReviewBundle({
				repository_path: repo.path,
			});

			sendResponse({
				ok: true,
				data: {
					repositoryPath: repo.path,
					diff: bundle.filteredDiff,
					promptText: bundle.promptText,
				},
			});
			return;
		}

		if (message.type === 'FETCH_BRANCH_DIFF') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const repos = await mcpClient.getWorkspaceRepos();
			const repo = findRepoForStagedChanges(
				repos,
				message.payload.host,
				message.payload.owner,
				message.payload.repo,
			);

			if (!repo) {
				sendResponse({
					ok: false,
					error: 'Could not determine which local workspace repo to use for branch comparison. Open the repo in VS Code, or keep only one matching repo open.',
				});
				return;
			}

			const diff = await mcpClient.getBranchDiff({
				repository_path: repo.path,
				base_ref: message.payload.baseRef,
				target_ref: message.payload.targetRef,
			});

			sendResponse({
				ok: true,
				data: {
					repositoryPath: repo.path,
					diff,
				},
			});
			return;
		}

		if (message.type === 'FETCH_BRANCH_REVIEW_BUNDLE') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const repos = await mcpClient.getWorkspaceRepos();
			const repo = findRepoForStagedChanges(
				repos,
				message.payload.host,
				message.payload.owner,
				message.payload.repo,
			);

			if (!repo) {
				sendResponse({
					ok: false,
					error: 'Could not determine which local workspace repo to use for branch review. Open the repo in VS Code, or keep only one matching repo open.',
				});
				return;
			}

			const bundle = await mcpClient.getBranchReviewBundle({
				repository_path: repo.path,
				base_ref: message.payload.baseRef,
				target_ref: message.payload.targetRef,
				prompt_mode: message.payload.promptMode ?? 'default',
				light_check_criteria: message.payload.lightCheckCriteria ?? [],
			});

			sendResponse({
				ok: true,
				data: {
					repositoryPath: repo.path,
					diff: bundle.filteredDiff,
					promptText: bundle.promptText,
				},
			});
			return;
		}

		if (message.type === 'FETCH_REPO_DEFAULTS') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const repos = await mcpClient.getWorkspaceRepos();
			const repo = findRepoForStagedChanges(
				repos,
				message.payload.host,
				message.payload.owner,
				message.payload.repo,
			);

			if (!repo) {
				sendResponse({
					ok: false,
					error: 'Could not determine which local workspace repo to use for branch defaults. Open the repo in VS Code, or keep only one matching repo open.',
				});
				return;
			}

			const repoConfig = await mcpClient.getRepoConfig({
				repository_path: repo.path,
			});

			sendResponse({
				ok: true,
				data: {
					repositoryPath: repo.path,
					defaultBaseBranch: repoConfig.defaultBaseBranch ?? '',
				},
			});
			return;
		}

		if (message.type === 'SCORE_REVIEW') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const scoreResult = await mcpClient.callTool('score_review', {
				review_text: message.payload.reviewText,
			});
			const scoreText = scoreResult.content?.find(entry => entry.type === 'text')?.text ?? '';

			sendResponse({
				ok: true,
				data: {
					scoreText,
				},
			});
			return;
		}

		if (message.type === 'FETCH_COMMIT_PROMPT') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const repos = await mcpClient.getWorkspaceRepos();
			const repo = findRepoForStagedChanges(
				repos,
				message.payload.host,
				message.payload.owner,
				message.payload.repo,
			);

			if (!repo) {
				sendResponse({
					ok: false,
					error: 'Could not determine which local workspace repo to use for commit message generation. Open the repo in VS Code, or keep only one matching repo open.',
				});
				return;
			}

			const bundle = await mcpClient.getCommitPromptBundle({
				repository_path: repo.path,
				existing_message: message.payload.existingMessage ?? '',
			});
			if (bundle.error) {
				sendResponse({
					ok: false,
					error: bundle.error,
				});
				return;
			}

			sendResponse({
				ok: true,
				data: {
					repositoryPath: repo.path,
					promptText: bundle.promptText ?? '',
					diffText: bundle.diffText ?? '',
					draftMessage: bundle.draftMessage ?? '',
				},
			});
			return;
		}

		if (message.type === 'APPLY_COMMIT_MESSAGE') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');
			await mcpClient.initialize();

			const repos = await mcpClient.getWorkspaceRepos();
			const repo = findRepoForStagedChanges(
				repos,
				message.payload.host,
				message.payload.owner,
				message.payload.repo,
			);

			if (!repo) {
				sendResponse({
					ok: false,
					error: 'Could not determine which local workspace repo to use when applying the commit message.',
				});
				return;
			}

			const result = await mcpClient.callTool('set_commit_message', {
				repository_path: repo.path,
				commit_message: message.payload.commitMessage,
			});
			const resultText = result.content?.find(entry => entry.type === 'text')?.text ?? '';

			sendResponse({
				ok: true,
				data: {
					repositoryPath: repo.path,
					resultText,
				},
			});
			return;
		}

		if (message.type === 'TEST_MCP_CONNECTION') {
			const stored = await chrome.storage.local.get('mcpToken');
			mcpClient.setToken((stored.mcpToken as string | undefined) ?? '');

			const healthResponse = await fetch('http://127.0.0.1:19840/health');
			if (!healthResponse.ok) {
				throw new Error(`MCP health check failed with HTTP ${healthResponse.status}`);
			}

			const health = await healthResponse.json() as { status?: string; server?: string };
			await mcpClient.initialize();

			const configResult = await mcpClient.callTool('get_config', {});
			const configText = configResult.content?.find(entry => entry.type === 'text')?.text ?? '{}';
			const workspaceRepos = await mcpClient.getWorkspaceRepos();

			sendResponse({
				ok: true,
				data: {
					health,
					workspaceRepoCount: workspaceRepos.length,
					configPreview: configText,
				},
			});
			return;
		}

		sendResponse({ ok: false, error: 'Unsupported message type.' });
	})().catch((error: unknown) => {
		sendResponse({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	});

	return true;
});

function findMatchingRepo(
	repos: WorkspaceRepo[],
	host: string,
	owner: string,
	repo: string,
): WorkspaceRepo | undefined {
	const target = `https://${host}/${owner}/${repo}`.toLowerCase();
	return repos.find(candidate =>
		candidate.remotes.some(remote => normalizeRemote(remote) === target),
	);
}

function findRepoForStagedChanges(
	repos: WorkspaceRepo[],
	host?: string,
	owner?: string,
	repo?: string,
): WorkspaceRepo | undefined {
	if (host && owner && repo) {
		const matched = findMatchingRepo(repos, host, owner, repo);
		if (matched) {
			return matched;
		}
	}

	if (repos.length === 1) {
		return repos[0];
	}

	return undefined;
}

function normalizeRemote(remote: string): string {
	return remote
		.replace(/^git@([^:]+):/, 'https://$1/')
		.replace(/\.git$/, '')
		.toLowerCase();
}
