import * as assert from 'assert';
import { isProtectedMcpPortOwner } from '../mcp/transport';

suite('MCP Transport Test Suite', () => {
	test('identifies VS Code extension-host processes as protected port owners', () => {
		const commandLine = [
			'/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
			'--type=utility',
			'--utility-sub-type=node.mojom.NodeService',
			'--type=extensionHost',
		].join(' ');

		assert.strictEqual(isProtectedMcpPortOwner(commandLine), true);
	});

	test('does not protect unrelated local port owners', () => {
		assert.strictEqual(isProtectedMcpPortOwner('node ./scripts/dev-server.js --port 19840'), false);
		assert.strictEqual(isProtectedMcpPortOwner(undefined), false);
	});
});
