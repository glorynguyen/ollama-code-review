import * as assert from 'assert';
import { registerAllResources } from '../mcp/resources';
import { mcpBridge } from '../mcp/context';
import { registerUtilityTools } from '../mcp/tools/scoreTools';

type Handler = (args?: any) => Promise<any>;

function createServer(): {
	tools: Map<string, Handler>;
	resources: Map<string, Handler>;
	server: any;
} {
	const tools = new Map<string, Handler>();
	const resources = new Map<string, Handler>();
	const server = {
		registerTool(name: string, _config: unknown, handler: Handler): void {
			tools.set(name, handler);
		},
		registerResource(name: string, _uri: string, _config: unknown, handler: Handler): void {
			resources.set(name, handler);
		},
	};
	return { tools, resources, server };
}

suite('MCP Config Export Test Suite', () => {
	let originalGetConfig: typeof mcpBridge.getConfig;
	let originalLog: typeof mcpBridge.log;

	setup(() => {
		originalGetConfig = mcpBridge.getConfig;
		originalLog = mcpBridge.log;

		const values = new Map<string, unknown>([
			['model', 'custom'],
			['customModel', 'kimi-k2.5:cloud'],
			['endpoint', 'http://localhost:11434/api/generate'],
			['temperature', 0],
			['frameworks', ['TypeScript']],
			['diffFilter', {}],
			['contextGathering', {}],
			['knowledgeBase', {}],
			['agentMode', {}],
			['mcp.enabled', true],
			['mcp.port', 19840],
			['mcp.autoKillPortConflicts', true],
			['mcp.allowedOrigins', ['chrome-extension://*']],
			['mcp.authToken', 'secret'],
			['mcp.semble.pythonPath', '/venv/bin/python'],
		]);

		(mcpBridge as any).getConfig = () => ({
			get: (key: string, defaultValue?: unknown) => values.has(key) ? values.get(key) : defaultValue,
		});
		(mcpBridge as any).log = () => {};
	});

	teardown(() => {
		(mcpBridge as any).getConfig = originalGetConfig;
		(mcpBridge as any).log = originalLog;
	});

	test('get_config reports whether a Semble Python path is configured', async () => {
		const { tools, server } = createServer();
		registerUtilityTools(server);

		const result = await tools.get('get_config')!();
		const body = JSON.parse(result.content[0].text);

		assert.strictEqual(body.mcp.authTokenConfigured, true);
		assert.strictEqual(body.mcp.semblePythonPathConfigured, true);
	});

	test('extension-config resource reports whether a Semble Python path is configured', async () => {
		const { resources, server } = createServer();
		registerAllResources(server);

		const result = await resources.get('extension-config')!();
		const body = JSON.parse(result.contents[0].text);

		assert.strictEqual(result.contents[0].uri, 'review://config');
		assert.strictEqual(body.mcp.authTokenConfigured, true);
		assert.strictEqual(body.mcp.semblePythonPathConfigured, true);
	});
});
