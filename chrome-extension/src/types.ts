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

export type BackgroundMessage =
	| FetchPrDiffMessage
	| FetchBranchDiffMessage
	| ApplyCommitMessageMessage
	| FetchCommitPromptMessage
	| ScoreReviewMessage
	| FetchStagedDiffMessage
	| SetMcpTokenMessage
	| TestMcpConnectionMessage;
