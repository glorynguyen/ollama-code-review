"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpClient = void 0;
class McpClient {
    endpoint;
    initialized = false;
    nextId = 1;
    token = '';
    constructor(endpoint) {
        this.endpoint = endpoint;
    }
    setToken(token) {
        this.token = token.trim();
    }
    async initialize() {
        if (this.initialized) {
            return;
        }
        await this.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
                name: 'ocr-browser-review',
                version: '0.1.0',
            },
        });
        this.initialized = true;
    }
    async getWorkspaceRepos() {
        const result = await this.callTool('get_workspace_repos', {});
        return JSON.parse(extractText(result));
    }
    async getBranchDiff(args) {
        const result = await this.callTool('get_branch_diff', args);
        return extractText(result);
    }
    async getStagedDiff(args = {}) {
        const result = await this.callTool('get_staged_diff', args);
        return extractText(result);
    }
    async callTool(name, args) {
        return this.request('tools/call', {
            name,
            arguments: args,
        });
    }
    async request(method, params) {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'MCP-Protocol-Version': '2024-11-05',
        };
        if (this.token) {
            headers['X-OCR-MCP-Token'] = this.token;
        }
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: this.nextId++,
                method,
                params,
            }),
        });
        if (!response.ok) {
            throw new Error(`MCP request failed with HTTP ${response.status}`);
        }
        const payload = await response.json();
        if ('error' in payload) {
            throw new Error(payload.error.message);
        }
        return payload.result;
    }
}
exports.McpClient = McpClient;
function extractText(result) {
    const text = result.content?.find(entry => entry.type === 'text')?.text;
    if (!text) {
        throw new Error('MCP tool returned no text content.');
    }
    return text;
}
//# sourceMappingURL=mcpClient.js.map