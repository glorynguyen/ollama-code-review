import { ModelManager } from './modelManager';
import type {
	ApplyCommitMessageMessage,
	FetchBranchDiffMessage,
	FetchCommitPromptMessage,
	FetchPrDiffMessage,
	FetchStagedDiffMessage,
	PageContext,
	ScoreReviewMessage,
	SetMcpTokenMessage,
	TestMcpConnectionMessage,
} from './types';

const modelManager = new ModelManager();

const repoMetaEl = getElement<HTMLParagraphElement>('repo-meta');
const statusEl = getElement<HTMLDivElement>('status');
const mcpTestResultEl = getElement<HTMLDivElement>('mcp-test-result');
const outputPreviewEl = getElement<HTMLDivElement>('output-preview');
const outputEl = getElement<HTMLPreElement>('output');
const tokenInput = getElement<HTMLInputElement>('mcp-token-input');
const modelSelect = getElement<HTMLSelectElement>('model-select');
const baseRefInput = getElement<HTMLInputElement>('base-ref-input');
const targetRefInput = getElement<HTMLInputElement>('target-ref-input');
const commitDraftInput = getElement<HTMLInputElement>('commit-draft-input');
const saveTokenButton = getElement<HTMLButtonElement>('save-token-btn');
const testMcpButton = getElement<HTMLButtonElement>('test-mcp-btn');
const previewTabButton = getElement<HTMLButtonElement>('preview-tab-btn');
const markdownTabButton = getElement<HTMLButtonElement>('markdown-tab-btn');
const loadModelButton = getElement<HTMLButtonElement>('load-model-btn');
const reviewStagedButton = getElement<HTMLButtonElement>('review-staged-btn');
const reviewBranchesButton = getElement<HTMLButtonElement>('review-branches-btn');
const generateCommitButton = getElement<HTMLButtonElement>('generate-commit-btn');
const runReviewButton = getElement<HTMLButtonElement>('run-review-btn');
const closeButton = getElement<HTMLButtonElement>('close-btn');

let pageContext: PageContext | null = null;
let outputMarkdown = '';

resetOutput();

window.addEventListener('message', (event: MessageEvent) => {
	if (event.data?.type !== 'OCR_PAGE_CONTEXT') {
		return;
	}

	pageContext = event.data.payload as PageContext;
	repoMetaEl.textContent = `${pageContext.owner}/${pageContext.repo} · ${pageContext.baseRef} → ${pageContext.headRef}`;
	baseRefInput.value = pageContext.baseRef;
	targetRefInput.value = pageContext.headRef;
	statusEl.textContent = 'PR context received from the current page.';
});

void hydrateToken();

saveTokenButton.addEventListener('click', () => {
	void saveToken().catch(renderError);
});

testMcpButton.addEventListener('click', () => {
	void testMcpConnection().catch(renderError);
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

runReviewButton.addEventListener('click', () => {
	void runReview().catch(renderError);
});

closeButton.addEventListener('click', () => {
	window.parent.postMessage({ type: 'OCR_CLOSE_OVERLAY' }, '*');
});

async function hydrateToken(): Promise<void> {
	const stored = await chrome.storage.local.get('mcpToken');
	tokenInput.value = (stored.mcpToken as string | undefined) ?? '';
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
}

async function testMcpConnection(): Promise<void> {
	statusEl.textContent = 'Testing MCP connection...';
	mcpTestResultEl.hidden = true;
	mcpTestResultEl.textContent = '';

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
	mcpTestResultEl.hidden = false;
	mcpTestResultEl.textContent = [
		'MCP connection OK',
		`Server: ${response.data.health?.server ?? 'unknown'}`,
		`Health: ${response.data.health?.status ?? 'unknown'}`,
		`Workspace repos found: ${response.data.workspaceRepoCount ?? 0}`,
		'Config preview:',
		configPreview,
	].join('\n');
	statusEl.textContent = 'MCP connection test succeeded.';
}

async function runReview(): Promise<void> {
	if (!pageContext) {
		statusEl.textContent = 'No pull request context available yet.';
		return;
	}

	resetOutput();
	statusEl.textContent = 'Loading model and retrieving local diff...';

	await modelManager.ensureLoaded(modelSelect.value, updateProgress);

	const message: FetchPrDiffMessage = {
		type: 'FETCH_PR_DIFF',
		payload: {
			host: pageContext.host,
			owner: pageContext.owner,
			repo: pageContext.repo,
			baseRef: pageContext.baseRef,
			headRef: pageContext.headRef,
		},
	};

	const response = await chrome.runtime.sendMessage(message);
	if (!response?.ok) {
		throw new Error(response?.error ?? 'Failed to fetch diff from MCP.');
	}

	statusEl.textContent = 'Generating browser-side review...';
	const reviewText = await modelManager.reviewDiff(
		{
			modelId: modelSelect.value,
			prTitle: pageContext.prTitle,
			prDescription: pageContext.prDescription,
			diff: response.data.diff as string,
		},
		(token) => {
			appendOutput(token);
		},
	);
	await appendScoreSafely(reviewText);
	statusEl.textContent = 'Review complete.';
}

async function runStagedReview(): Promise<void> {
	resetOutput();
	statusEl.textContent = 'Loading model and retrieving staged changes...';

	await modelManager.ensureLoaded(modelSelect.value, updateProgress);

	const message: FetchStagedDiffMessage = {
		type: 'FETCH_STAGED_DIFF',
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

	statusEl.textContent = 'Generating staged-changes review...';
	const reviewText = await modelManager.reviewDiff(
		{
			modelId: modelSelect.value,
			prTitle: pageContext?.prTitle ?? 'Local staged changes',
			prDescription: pageContext?.prDescription ?? 'Reviewing local staged changes from the current workspace.',
			diff: response.data.diff as string,
		},
		(token) => {
			appendOutput(token);
		},
	);
	await appendScoreSafely(reviewText);
	statusEl.textContent = 'Staged-changes review complete.';
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

	const message: FetchBranchDiffMessage = {
		type: 'FETCH_BRANCH_DIFF',
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

	statusEl.textContent = `Generating branch comparison review (${baseRef} → ${targetRef})...`;
	const reviewText = await modelManager.reviewDiff(
		{
			modelId: modelSelect.value,
			prTitle: pageContext?.prTitle ?? `Branch comparison: ${baseRef} → ${targetRef}`,
			prDescription: pageContext?.prDescription ?? `Reviewing changes between ${baseRef} and ${targetRef}.`,
			diff: response.data.diff as string,
		},
		(token) => {
			appendOutput(token);
		},
	);
	await appendScoreSafely(reviewText);
	statusEl.textContent = `Branch comparison review complete (${baseRef} → ${targetRef}).`;
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
	statusEl.textContent = error instanceof Error ? error.message : String(error);
	mcpTestResultEl.hidden = false;
	mcpTestResultEl.textContent = statusEl.textContent;
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
