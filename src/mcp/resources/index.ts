import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpBridge } from '../context';
import { ReviewScoreStore } from '../../reviewScore';

/**
 * Register all MCP resources on the server.
 */
export function registerAllResources(server: McpServer): void {

	// Review score history
	server.resource(
		'review-scores',
		'review://scores',
		{ description: 'Review quality score history (JSON)' },
		async () => {
			let scores: unknown[] = [];
			try {
				const store = ReviewScoreStore.getInstance(mcpBridge.getGlobalStoragePath());
				scores = store.getScores();
			} catch {
				// Store may not be initialized yet
			}

			return {
				contents: [{
					uri: 'review://scores',
					mimeType: 'application/json',
					text: JSON.stringify(scores, null, 2),
				}],
			};
		},
	);

	// Current extension configuration
	server.resource(
		'extension-config',
		'review://config',
		{ description: 'Current Ollama Code Review extension configuration' },
		async () => {
			const config = mcpBridge.getConfig();
			const exportedConfig = {
				model: config.get('model'),
				endpoint: config.get('endpoint'),
				temperature: config.get('temperature'),
				frameworks: config.get('frameworks'),
				mcp: {
					enabled: config.get('mcp.enabled'),
					port: config.get('mcp.port'),
					autoKillPortConflicts: config.get('mcp.autoKillPortConflicts'),
					allowedOrigins: config.get('mcp.allowedOrigins'),
					authTokenConfigured: !!config.get('mcp.authToken'),
				},
			};

			return {
				contents: [{
					uri: 'review://config',
					mimeType: 'application/json',
					text: JSON.stringify(exportedConfig, null, 2),
				}],
			};
		},
	);
}
