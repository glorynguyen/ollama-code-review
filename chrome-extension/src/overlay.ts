import { ModelManager, type ReviewProgress } from './modelManager';
import type {
	ApplyCommitMessageMessage,
	FetchBranchReviewBundleMessage,
	FetchRepoDefaultsMessage,
	FetchCommitPromptMessage,
	FetchStagedReviewBundleMessage,
	PageContext,
	ScoreReviewMessage,
	SetMcpTokenMessage,
	TestMcpConnectionMessage,
} from './types';

const modelManager = new ModelManager();

const repoMetaEl = getElement<HTMLParagraphElement>('repo-meta');
const repoPathEl = getElement<HTMLParagraphElement>('repo-path');
const statusEl = getElement<HTMLDivElement>('status');
const reviewRunnerEl = getElement<HTMLDivElement>('review-runner');
const reviewProgressLabelEl = getElement<HTMLSpanElement>('review-progress-label');
const reviewProgressBarEl = getElement<HTMLProgressElement>('review-progress-bar');
const cancelReviewButton = getElement<HTMLButtonElement>('cancel-review-btn');
const mcpTestResultEl = getElement<HTMLDivElement>('mcp-test-result');
const mcpTestResultTextEl = getElement<HTMLPreElement>('mcp-test-result-text');
const mcpStatusChipEl = getElement<HTMLButtonElement>('mcp-status-chip');
const mcpStatusTextEl = getElement<HTMLSpanElement>('mcp-status-text');
const outputPreviewEl = getElement<HTMLDivElement>('output-preview');
const outputEl = getElement<HTMLPreElement>('output');
const tokenInput = getElement<HTMLInputElement>('mcp-token-input');
const modelSelect = getElement<HTMLSelectElement>('model-select');
const baseRefInput = getElement<HTMLInputElement>('base-ref-input');
const baseRefHintEl = getElement<HTMLElement>('base-ref-hint');
const targetRefInput = getElement<HTMLInputElement>('target-ref-input');
const commitDraftInput = getElement<HTMLInputElement>('commit-draft-input');
const saveTokenButton = getElement<HTMLButtonElement>('save-token-btn');
const testMcpButton = getElement<HTMLButtonElement>('test-mcp-btn');
const closeMcpResultButton = getElement<HTMLButtonElement>('close-mcp-result-btn');
const previewTabButton = getElement<HTMLButtonElement>('preview-tab-btn');
const markdownTabButton = getElement<HTMLButtonElement>('markdown-tab-btn');
const loadModelButton = getElement<HTMLButtonElement>('load-model-btn');
const reviewStagedButton = getElement<HTMLButtonElement>('review-staged-btn');
const reviewBranchesButton = getElement<HTMLButtonElement>('review-branches-btn');
const generateCommitButton = getElement<HTMLButtonElement>('generate-commit-btn');
const closeButton = getElement<HTMLButtonElement>('close-btn');

let pageContext: PageContext | null = null;
let outputMarkdown = '';

resetOutput();
void refreshMcpStatus(false);

window.addEventListener('message', (event: MessageEvent) => {
	if (event.data?.type !== 'OCR_PAGE_CONTEXT') {
		return;
	}

	pageContext = event.data.payload as PageContext;
	repoMetaEl.textContent = `${pageContext.owner}/${pageContext.repo} · ${pageContext.baseRef} → ${pageContext.headRef}`;
	repoPathEl.hidden = true;
	baseRefInput.value = pageContext.baseRef;
	updateBaseRefHint(`Using pull request base branch: ${pageContext.baseRef}`);
	targetRefInput.value = pageContext.headRef;
	statusEl.textContent = 'PR context received from the current page.';
	void hydrateRepoDefaults().catch(renderError);
});

void hydrateToken();

saveTokenButton.addEventListener('click', () => {
	void saveToken().catch(renderError);
});

testMcpButton.addEventListener('click', () => {
	void refreshMcpStatus(true).catch(renderError);
});

mcpStatusChipEl.addEventListener('click', () => {
	if (mcpTestResultEl.hidden) {
		void refreshMcpStatus(true).catch(renderError);
	} else {
		hideMcpDetails();
	}
});

closeMcpResultButton.addEventListener('click', () => {
	hideMcpDetails();
});

cancelReviewButton.addEventListener('click', () => {
	cancelReviewButton.disabled = true;
	statusEl.textContent = 'Cancelling review...';
	void modelManager.cancelGeneration().catch(renderError);
});

previewTabButton.addEventListener('click', () => {
	setActiveOutputTab('preview');
});

markdownTabButton.addEventListener('click', () => {
	setActiveOutputTab('markdown');
});

loadModelButton.addEventListener('click', () => {
	void modelManager.ensureLoaded(modelSelect.value, updateProgress).then(() => {
		statusEl.textContent = `Model ready: ${modelSelect.value}`;
	}).catch(renderError);
});

reviewStagedButton.addEventListener('click', () => {
	void runStagedReview().catch(renderError);
});

reviewBranchesButton.addEventListener('click', () => {
	void runBranchReview().catch(renderError);
});

generateCommitButton.addEventListener('click', () => {
	void runCommitMessageGeneration().catch(renderError);
});

closeButton.addEventListener('click', () => {
	window.parent.postMessage({ type: 'OCR_CLOSE_OVERLAY' }, '*');
});

async function hydrateToken(): Promise<void> {
	const stored = await chrome.storage.local.get('mcpToken');
	tokenInput.value = (stored.mcpToken as string | undefined) ?? '';
}

async function hydrateRepoDefaults(): Promise<void> {
	const message: FetchRepoDefaultsMessage = {
		type: 'FETCH_REPO_DEFAULTS',
		payload: {
			host: pageContext?.host,
			owner: pageContext?.owner,
			repo: pageContext?.repo,
		},
	};
	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		return;
	}

	const repositoryPath = String(response.data?.repositoryPath ?? '').trim();
	if (repositoryPath) {
		repoPathEl.textContent = repositoryPath;
		repoPathEl.hidden = false;
	}

	const defaultBaseBranch = String(response.data?.defaultBaseBranch ?? '').trim();
	if (defaultBaseBranch) {
		baseRefInput.value = defaultBaseBranch;
		baseRefInput.placeholder = defaultBaseBranch;
		updateBaseRefHint(`Using VS Code repo default base branch: ${defaultBaseBranch}`);
		return;
	}

	if (pageContext?.baseRef) {
		updateBaseRefHint(`Using pull request base branch: ${pageContext.baseRef}`);
	}
}

function updateBaseRefHint(text: string): void {
	baseRefHintEl.textContent = text;
}

async function saveToken(): Promise<void> {
	const message: SetMcpTokenMessage = {
		type: 'SET_MCP_TOKEN',
		payload: { token: tokenInput.value },
	};
	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		throw new Error(response?.error ?? 'Failed to save MCP token.');
	}
	statusEl.textContent = 'Saved MCP token for future local requests.';
	await refreshMcpStatus(false);
}

async function refreshMcpStatus(showDetails: boolean): Promise<void> {
	statusEl.textContent = 'Checking MCP connection...';
	setMcpStatus('checking', 'Checking MCP…');
	const saveMessage: SetMcpTokenMessage = {
		type: 'SET_MCP_TOKEN',
		payload: { token: tokenInput.value },
	};
	const saveResponse = await chrome.runtime.sendMessage(saveMessage);
	if (!saveResponse?.ok) {
		throw new Error(saveResponse?.error ?? 'Failed to save MCP token before testing.');
	}

	const testMessage: TestMcpConnectionMessage = {
		type: 'TEST_MCP_CONNECTION',
		payload: {},
	};
	const response = await chrome.runtime.sendMessage(testMessage);
	if (!response?.ok) {
		throw new Error(response?.error ?? 'MCP connection test failed.');
	}

	const configPreview = truncateText(String(response.data.configPreview ?? '{}'), 600);
	const details = [
		'MCP connection OK',
		`Server: ${response.data.health?.server ?? 'unknown'}`,
		`Health: ${response.data.health?.status ?? 'unknown'}`,
		`Workspace repos found: ${response.data.workspaceRepoCount ?? 0}`,
		'Config preview:',
		configPreview,
	].join('\n');
	setMcpStatus('connected', `MCP connected · ${response.data.workspaceRepoCount ?? 0} repo(s)`);
	if (showDetails) {
		showMcpDetails(details);
	}
	statusEl.textContent = 'MCP connection test succeeded.';
}

async function runStagedReview(): Promise<void> {
	resetOutput();
	statusEl.textContent = 'Loading model and retrieving staged changes...';

	await modelManager.ensureLoaded(modelSelect.value, updateProgress);

	const message: FetchStagedReviewBundleMessage = {
		type: 'FETCH_STAGED_REVIEW_BUNDLE',
		payload: {
			host: pageContext?.host,
			owner: pageContext?.owner,
			repo: pageContext?.repo,
		},
	};

	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		throw new Error(response?.error ?? 'Failed to fetch staged diff from MCP.');
	}

	await runCancelableReview(
		'Generating staged-changes review...',
		{
			modelId: modelSelect.value,
			promptText: String(response.data.promptText ?? ''),
			prTitle: pageContext?.prTitle ?? 'Local staged changes',
			prDescription: pageContext?.prDescription ?? 'Reviewing local staged changes from the current workspace.',
			diff: response.data.diff as string,
		},
		'Staged-changes review complete.',
	);
}

async function runBranchReview(): Promise<void> {
	const baseRef = baseRefInput.value.trim();
	const targetRef = targetRefInput.value.trim();

	if (!baseRef || !targetRef) {
		throw new Error('Both base branch and target branch are required.');
	}

	resetOutput();
	statusEl.textContent = `Loading model and retrieving branch diff (${baseRef} → ${targetRef})...`;

	await modelManager.ensureLoaded(modelSelect.value, updateProgress);

	const message: FetchBranchReviewBundleMessage = {
		type: 'FETCH_BRANCH_REVIEW_BUNDLE',
		payload: {
			host: pageContext?.host,
			owner: pageContext?.owner,
			repo: pageContext?.repo,
			baseRef,
			targetRef,
		},
	};

	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		throw new Error(response?.error ?? 'Failed to fetch branch diff from MCP.');
	}

	await runCancelableReview(
		`Generating branch comparison review (${baseRef} → ${targetRef})...`,
		{
			modelId: modelSelect.value,
			promptText: String(response.data.promptText ?? ''),
			prTitle: pageContext?.prTitle ?? `Branch comparison: ${baseRef} → ${targetRef}`,
			prDescription: pageContext?.prDescription ?? `Reviewing changes between ${baseRef} and ${targetRef}.`,
			diff: response.data.diff as string,
		},
		`Branch comparison review complete (${baseRef} → ${targetRef}).`,
	);
}

async function runCommitMessageGeneration(): Promise<void> {
	resetOutput();
	statusEl.textContent = 'Loading model and preparing commit message prompt...';

	await modelManager.ensureLoaded(modelSelect.value, updateProgress);

	const message: FetchCommitPromptMessage = {
		type: 'FETCH_COMMIT_PROMPT',
		payload: {
			host: pageContext?.host,
			owner: pageContext?.owner,
			repo: pageContext?.repo,
			existingMessage: commitDraftInput.value.trim(),
		},
	};

	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		throw new Error(response?.error ?? 'Failed to fetch commit prompt from MCP.');
	}

	statusEl.textContent = 'Generating commit message from staged changes...';
	const commitMessage = await modelManager.generateCommitMessage(
		{
			modelId: modelSelect.value,
			commitPrompt: String(response.data.promptText ?? ''),
		},
		(token) => {
			appendOutput(token);
		},
	);

	outputMarkdown = normalizeCommitMessage(commitMessage);
	renderOutput();
	const applyResult = await applyCommitMessageToVscode(commitMessage);
	statusEl.textContent = applyResult || 'Commit message generated and applied to VS Code.';
}

function updateProgress(progress: { text: string; progress?: number }): void {
	if (typeof progress.progress === 'number') {
		statusEl.textContent = `${progress.text} (${Math.round(progress.progress * 100)}%)`;
		return;
	}
	statusEl.textContent = progress.text;
}

function renderError(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	statusEl.textContent = message;
	if (message === 'Review cancelled.') {
		return;
	}
	setMcpStatus('error', 'MCP error');
	showMcpDetails(statusEl.textContent);
}

function resetOutput(): void {
	outputMarkdown = '';
	renderOutput();
	setActiveOutputTab('preview');
}

function appendOutput(token: string): void {
	outputMarkdown += token;
	renderOutput();
}

function appendReviewScore(scoreText: string): void {
	if (!scoreText.trim()) {
		return;
	}
	outputMarkdown += `\n\n---\n\n${scoreText.trim()}\n`;
	renderOutput();
}

function renderOutput(): void {
	outputEl.textContent = outputMarkdown;
	outputPreviewEl.innerHTML = renderMarkdown(outputMarkdown);
}

function setActiveOutputTab(tab: 'preview' | 'markdown'): void {
	const previewActive = tab === 'preview';
	outputPreviewEl.hidden = !previewActive;
	outputEl.hidden = previewActive;
	previewTabButton.classList.toggle('active', previewActive);
	markdownTabButton.classList.toggle('active', !previewActive);
	previewTabButton.classList.toggle('ghost', !previewActive);
	markdownTabButton.classList.toggle('ghost', previewActive);
}

function getElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing overlay element: ${id}`);
	}
	return element as T;
}

function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.slice(0, maxLength)}\n...`;
}

function setMcpStatus(state: 'checking' | 'connected' | 'error', text: string): void {
	mcpStatusChipEl.classList.remove('status-chip--checking', 'status-chip--connected', 'status-chip--error');
	mcpStatusChipEl.classList.add(`status-chip--${state}`);
	mcpStatusTextEl.textContent = text;
}

function showMcpDetails(details: string): void {
	mcpTestResultTextEl.textContent = details;
	mcpTestResultEl.hidden = false;
}

function hideMcpDetails(): void {
	mcpTestResultEl.hidden = true;
}

function normalizeCommitMessage(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) {
		return 'No commit message was generated.';
	}

	return [
		'## Commit Message',
		'',
		'```text',
		trimmed,
		'```',
	].join('\n');
}

async function fetchReviewScore(reviewText: string): Promise<string> {
	const message: ScoreReviewMessage = {
		type: 'SCORE_REVIEW',
		payload: { reviewText },
	};
	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		throw new Error(response?.error ?? 'Failed to score review via MCP.');
	}
	return String(response.data.scoreText ?? '');
}

async function appendScoreSafely(reviewText: string): Promise<void> {
	try {
		appendReviewScore(await fetchReviewScore(reviewText));
	} catch (error) {
		appendReviewScore(`## Review Score\n\nScoring failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function runCancelableReview(
	startMessage: string,
	input: {
		modelId: string;
		promptText: string;
		prTitle: string;
		prDescription: string;
		diff: string;
	},
	completionMessage: string,
): Promise<void> {
	beginReviewRun(startMessage);

	try {
		statusEl.textContent = startMessage;
		const reviewText = await modelManager.reviewDiff(
			input,
			(token) => {
				appendOutput(token);
			},
			(progress) => {
				updateReviewProgress(progress);
			},
		);
		await appendScoreSafely(reviewText);
		statusEl.textContent = completionMessage;
	} finally {
		endReviewRun();
	}
}

function beginReviewRun(message: string): void {
	reviewRunnerEl.hidden = false;
	cancelReviewButton.disabled = false;
	reviewProgressLabelEl.textContent = message;
	reviewProgressBarEl.max = 1;
	reviewProgressBarEl.removeAttribute('value');
}

function endReviewRun(): void {
	reviewRunnerEl.hidden = true;
	cancelReviewButton.disabled = false;
}

function updateReviewProgress(progress: ReviewProgress): void {
	reviewProgressLabelEl.textContent = progress.message;
	if (progress.indeterminate || !progress.total || progress.total <= 0) {
		reviewProgressBarEl.max = 1;
		reviewProgressBarEl.removeAttribute('value');
		return;
	}

	reviewProgressBarEl.max = progress.total;
	reviewProgressBarEl.value = Math.min(progress.current ?? 0, progress.total);
}

async function applyCommitMessageToVscode(commitMessage: string): Promise<string> {
	const message: ApplyCommitMessageMessage = {
		type: 'APPLY_COMMIT_MESSAGE',
		payload: {
			host: pageContext?.host,
			owner: pageContext?.owner,
			repo: pageContext?.repo,
			commitMessage,
		},
	};
	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		throw new Error(response?.error ?? 'Failed to apply commit message to VS Code.');
	}
	return String(response.data.resultText ?? '');
}

function renderMarkdown(markdown: string): string {
	if (!markdown.trim()) {
		return '<p>No review output yet.</p>';
	}

	const codeBlocks: string[] = [];
	let text = escapeHtml(markdown).replace(/```([\w-]*)\n([\s\S]*?)```/g, (_match, language, code) => {
		const index = codeBlocks.push(
			`<pre><code class="language-${language || 'plain'}">${code.trim()}</code></pre>`,
		) - 1;
		return `@@CODEBLOCK_${index}@@`;
	});

	const lines = text.split('\n');
	const html: string[] = [];
	let paragraph: string[] = [];
	let listItems: string[] = [];
	let listType: 'ul' | 'ol' | null = null;

	const flushParagraph = (): void => {
		if (paragraph.length === 0) {
			return;
		}
		html.push(`<p>${applyInlineMarkdown(paragraph.join(' '))}</p>`);
		paragraph = [];
	};

	const flushList = (): void => {
		if (listItems.length === 0 || !listType) {
			return;
		}
		html.push(`<${listType}>${listItems.join('')}</${listType}>`);
		listItems = [];
		listType = null;
	};

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();

		if (!trimmed) {
			flushParagraph();
			flushList();
			continue;
		}

		if (/^@@CODEBLOCK_\d+@@$/.test(trimmed)) {
			flushParagraph();
			flushList();
			html.push(trimmed);
			continue;
		}

		const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
		if (heading) {
			flushParagraph();
			flushList();
			const level = heading[1].length;
			html.push(`<h${level}>${applyInlineMarkdown(heading[2])}</h${level}>`);
			continue;
		}

		const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
		if (ulMatch) {
			flushParagraph();
			if (listType && listType !== 'ul') {
				flushList();
			}
			listType = 'ul';
			listItems.push(`<li>${applyInlineMarkdown(ulMatch[1])}</li>`);
			continue;
		}

		const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
		if (olMatch) {
			flushParagraph();
			if (listType && listType !== 'ol') {
				flushList();
			}
			listType = 'ol';
			listItems.push(`<li>${applyInlineMarkdown(olMatch[1])}</li>`);
			continue;
		}

		const blockquote = trimmed.match(/^&gt;\s?(.*)$/);
		if (blockquote) {
			flushParagraph();
			flushList();
			html.push(`<blockquote>${applyInlineMarkdown(blockquote[1])}</blockquote>`);
			continue;
		}

		flushList();
		paragraph.push(trimmed);
	}

	flushParagraph();
	flushList();

	return html
		.join('\n')
		.replace(/@@CODEBLOCK_(\d+)@@/g, (_match, index) => codeBlocks[Number(index)] ?? '');
}

function applyInlineMarkdown(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
