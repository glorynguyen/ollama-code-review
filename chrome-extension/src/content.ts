import type { PageContext } from './types';

const BUTTON_ID = 'ocr-browser-review-button';
const IFRAME_ID = 'ocr-browser-review-frame';

if (isPullRequestPage()) {
	injectReviewButton();
	window.addEventListener('message', handleOverlayMessage);
}

function isPullRequestPage(): boolean {
	return isGitHubPullRequest() || isGitLabMergeRequest();
}

function isGitHubPullRequest(): boolean {
	return /^\/[^/]+\/[^/]+\/pull\/\d+/.test(window.location.pathname);
}

function isGitLabMergeRequest(): boolean {
	return /\/-\/merge_requests\/\d+/.test(window.location.pathname);
}

function injectReviewButton(): void {
	if (document.getElementById(BUTTON_ID)) {
		return;
	}

	const button = document.createElement('button');
	button.id = BUTTON_ID;
	button.textContent = 'Review with AI';
	button.style.cssText = [
		'position: fixed',
		'right: 24px',
		'bottom: 24px',
		'z-index: 2147483646',
		'padding: 10px 14px',
		'border: none',
		'border-radius: 10px',
		'background: #111827',
		'color: #fff',
		'font: 600 13px/1 system-ui, sans-serif',
		'cursor: pointer',
		'box-shadow: 0 12px 28px rgba(15, 23, 42, 0.28)',
	].join(';');

	button.addEventListener('click', () => {
		openOverlay();
	});

	document.body.appendChild(button);
}

function openOverlay(): void {
	const iframe = ensureOverlayFrame();
	iframe.style.display = 'block';
	postPageContext(iframe);
}

function ensureOverlayFrame(): HTMLIFrameElement {
	let iframe = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
	if (iframe) {
		return iframe;
	}

	iframe = document.createElement('iframe');
	iframe.id = IFRAME_ID;
	iframe.src = chrome.runtime.getURL('ui/overlay.html');
	iframe.style.cssText = [
		'position: fixed',
		'top: 16px',
		'right: 16px',
		'width: min(560px, calc(100vw - 32px))',
		'height: calc(100vh - 32px)',
		'border: none',
		'border-radius: 16px',
		'background: #fff',
		'display: none',
		'z-index: 2147483647',
		'box-shadow: 0 24px 80px rgba(15, 23, 42, 0.32)',
	].join(';');
	iframe.addEventListener('load', () => {
		iframe.dataset.ready = 'true';
		postPageContext(iframe);
	});
	document.body.appendChild(iframe);
	return iframe;
}

function postPageContext(iframe: HTMLIFrameElement): void {
	if (iframe.dataset.ready !== 'true') {
		return;
	}

	iframe.contentWindow?.postMessage({
		type: 'OCR_PAGE_CONTEXT',
		payload: getPageContext(),
	}, '*');
}

function handleOverlayMessage(event: MessageEvent): void {
	if (event.data?.type !== 'OCR_CLOSE_OVERLAY') {
		return;
	}

	const iframe = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
	if (iframe) {
		iframe.style.display = 'none';
	}
}

function getPageContext(): PageContext {
	if (isGitHubPullRequest()) {
		return getGitHubPageContext();
	}
	return getGitLabPageContext();
}

function getGitHubPageContext(): PageContext {
	const [, owner = '', repo = ''] = window.location.pathname.split('/');
	const baseRef = document.querySelector<HTMLElement>('.base-ref')?.innerText.trim() ?? '';
	const headRef = document.querySelector<HTMLElement>('.head-ref')?.innerText.trim() ?? '';
	const prTitle = document.querySelector<HTMLElement>('.js-issue-title')?.innerText.trim() ?? document.title;
	const prDescription = document.querySelector<HTMLElement>('.comment-body')?.innerText.trim() ?? '';

	return {
		host: window.location.host,
		owner,
		repo,
		baseRef,
		headRef,
		prTitle,
		prDescription,
		provider: 'github',
	};
}

function getGitLabPageContext(): PageContext {
	const parts = window.location.pathname.split('/').filter(Boolean);
	const owner = parts[0] ?? '';
	const repo = parts[1] ?? '';
	const baseRef = document.querySelector<HTMLElement>('[data-testid="merge-request-base-ref"]')?.innerText.trim() ?? '';
	const headRef = document.querySelector<HTMLElement>('[data-testid="merge-request-source-ref"]')?.innerText.trim() ?? '';
	const prTitle = document.querySelector<HTMLElement>('[data-testid="issuable-title"]')?.innerText.trim() ?? document.title;
	const prDescription = document.querySelector<HTMLElement>('.description .md')?.innerText.trim() ?? '';

	return {
		host: window.location.host,
		owner,
		repo,
		baseRef,
		headRef,
		prTitle,
		prDescription,
		provider: 'gitlab',
	};
}
