"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const modelManager_1 = require("./modelManager");
const modelManager = new modelManager_1.ModelManager();
const repoMetaEl = getElement('repo-meta');
const statusEl = getElement('status');
const outputEl = getElement('output');
const tokenInput = getElement('mcp-token-input');
const modelSelect = getElement('model-select');
const saveTokenButton = getElement('save-token-btn');
const loadModelButton = getElement('load-model-btn');
const runReviewButton = getElement('run-review-btn');
const closeButton = getElement('close-btn');
let pageContext = null;
window.addEventListener('message', (event) => {
    if (event.data?.type !== 'OCR_PAGE_CONTEXT') {
        return;
    }
    pageContext = event.data.payload;
    repoMetaEl.textContent = `${pageContext.owner}/${pageContext.repo} · ${pageContext.baseRef} → ${pageContext.headRef}`;
    statusEl.textContent = 'PR context received from the current page.';
});
void hydrateToken();
saveTokenButton.addEventListener('click', () => {
    void saveToken().catch(renderError);
});
loadModelButton.addEventListener('click', () => {
    void modelManager.ensureLoaded(modelSelect.value, updateProgress).then(() => {
        statusEl.textContent = `Model ready: ${modelSelect.value}`;
    }).catch(renderError);
});
runReviewButton.addEventListener('click', () => {
    void runReview().catch(renderError);
});
closeButton.addEventListener('click', () => {
    window.parent.postMessage({ type: 'OCR_CLOSE_OVERLAY' }, '*');
});
async function hydrateToken() {
    const stored = await chrome.storage.local.get('mcpToken');
    tokenInput.value = stored.mcpToken ?? '';
}
async function saveToken() {
    const message = {
        type: 'SET_MCP_TOKEN',
        payload: { token: tokenInput.value },
    };
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
        throw new Error(response?.error ?? 'Failed to save MCP token.');
    }
    statusEl.textContent = 'Saved MCP token for future local requests.';
}
async function runReview() {
    if (!pageContext) {
        statusEl.textContent = 'No pull request context available yet.';
        return;
    }
    outputEl.textContent = '';
    statusEl.textContent = 'Loading model and retrieving local diff...';
    await modelManager.ensureLoaded(modelSelect.value, updateProgress);
    const message = {
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
    await modelManager.reviewDiff({
        modelId: modelSelect.value,
        prTitle: pageContext.prTitle,
        prDescription: pageContext.prDescription,
        diff: response.data.diff,
    }, (token) => {
        outputEl.textContent += token;
    });
    statusEl.textContent = 'Review complete.';
}
function updateProgress(progress) {
    if (typeof progress.progress === 'number') {
        statusEl.textContent = `${progress.text} (${Math.round(progress.progress * 100)}%)`;
        return;
    }
    statusEl.textContent = progress.text;
}
function renderError(error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
}
function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing overlay element: ${id}`);
    }
    return element;
}
//# sourceMappingURL=overlay.js.map