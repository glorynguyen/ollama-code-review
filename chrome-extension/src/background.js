"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcpClient_1 = require("./mcpClient");
const mcpClient = new mcpClient_1.McpClient('http://127.0.0.1:19840/mcp');
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
        if (message.type === 'SET_MCP_TOKEN') {
            await chrome.storage.local.set({ mcpToken: message.payload.token });
            sendResponse({ ok: true });
            return;
        }
        if (message.type === 'FETCH_PR_DIFF') {
            const stored = await chrome.storage.local.get('mcpToken');
            mcpClient.setToken(stored.mcpToken ?? '');
            await mcpClient.initialize();
            const repos = await mcpClient.getWorkspaceRepos();
            const repo = findMatchingRepo(repos, message.payload.host, message.payload.owner, message.payload.repo);
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
        sendResponse({ ok: false, error: 'Unsupported message type.' });
    })().catch((error) => {
        sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    });
    return true;
});
function findMatchingRepo(repos, host, owner, repo) {
    const target = `https://${host}/${owner}/${repo}`.toLowerCase();
    return repos.find(candidate => candidate.remotes.some(remote => normalizeRemote(remote) === target));
}
function normalizeRemote(remote) {
    return remote
        .replace(/^git@([^:]+):/, 'https://$1/')
        .replace(/\.git$/, '')
        .toLowerCase();
}
//# sourceMappingURL=background.js.map