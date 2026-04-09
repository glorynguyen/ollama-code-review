export interface PageContext {
	host: string;
	owner: string;
	repo: string;
	baseRef: string;
	headRef: string;
	prTitle: string;
	prDescription: string;
	provider: 'github' | 'gitlab';
}

export interface WorkspaceRepo {
	name: string;
	path: string;
	remotes: string[];
}

export interface FetchPrDiffMessage {
	type: 'FETCH_PR_DIFF';
	payload: Pick<PageContext, 'host' | 'owner' | 'repo' | 'baseRef' | 'headRef'>;
}

export interface FetchBranchDiffMessage {
	type: 'FETCH_BRANCH_DIFF';
	payload: {
		host?: string;
		owner?: string;
		repo?: string;
		baseRef: string;
		targetRef: string;
	};
}

export interface FetchStagedReviewBundleMessage {
	type: 'FETCH_STAGED_REVIEW_BUNDLE';
	payload: {
		host?: string;
		owner?: string;
		repo?: string;
	};
}

export interface FetchBranchReviewBundleMessage {
	type: 'FETCH_BRANCH_REVIEW_BUNDLE';
	payload: {
		host?: string;
		owner?: string;
		repo?: string;
		baseRef: string;
		targetRef: string;
		promptMode?: 'default' | 'light-check';
		lightCheckCriteria?: string[];
	};
}

export interface FetchRepoDefaultsMessage {
	type: 'FETCH_REPO_DEFAULTS';
	payload: {
		host?: string;
		owner?: string;
		repo?: string;
	};
}

export interface ScoreReviewMessage {
	type: 'SCORE_REVIEW';
	payload: {
		reviewText: string;
	};
}

export interface FetchCommitPromptMessage {
	type: 'FETCH_COMMIT_PROMPT';
	payload: {
		host?: string;
		owner?: string;
		repo?: string;
		existingMessage?: string;
	};
}

export interface ApplyCommitMessageMessage {
	type: 'APPLY_COMMIT_MESSAGE';
	payload: {
		host?: string;
		owner?: string;
		repo?: string;
		commitMessage: string;
	};
}

export interface FetchStagedDiffMessage {
	type: 'FETCH_STAGED_DIFF';
	payload: {
		host?: string;
		owner?: string;
		repo?: string;
	};
}

export interface SetMcpTokenMessage {
	type: 'SET_MCP_TOKEN';
	payload: { token: string };
}

export interface TestMcpConnectionMessage {
	type: 'TEST_MCP_CONNECTION';
	payload?: {};
}

export interface NotifySlackMessage {
	type: 'NOTIFY_SLACK';
	payload: {
		task: string;
		status: string;
		repo?: string;
		pr?: string;
	};
}

export interface CallMcpToolMessage {
	type: 'CALL_MCP_TOOL';
	payload: {
		name: string;
		args: Record<string, unknown>;
	};
}

export interface ListMcpToolsMessage {
	type: 'LIST_MCP_TOOLS';
	payload?: {};
}

export interface OpenOverlayWindowMessage {
	type: 'OPEN_OVERLAY_WINDOW';
	payload?: {};
}

export type BackgroundMessage =
	| FetchPrDiffMessage
	| FetchBranchDiffMessage
	| FetchStagedReviewBundleMessage
	| FetchBranchReviewBundleMessage
	| FetchRepoDefaultsMessage
	| ApplyCommitMessageMessage
	| FetchCommitPromptMessage
	| ScoreReviewMessage
	| FetchStagedDiffMessage
	| SetMcpTokenMessage
	| TestMcpConnectionMessage
	| NotifySlackMessage
	| CallMcpToolMessage
	| ListMcpToolsMessage
	| OpenOverlayWindowMessage;
