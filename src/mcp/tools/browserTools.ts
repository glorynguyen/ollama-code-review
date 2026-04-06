import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mcpBridge } from '../context';

export function registerBrowserTools(server: McpServer): void {

	server.tool(
		'get_workspace_repos',
		'List open workspace folders and their git remotes so browser clients can map a PR URL to a local repository path.',
		{},
		async () => {
			const repos: Array<{
				name: string;
				path: string;
				remotes: string[];
			}> = [];

			for (const folder of mcpBridge.getWorkspaceFolders()) {
				try {
					const rawRemotes = await mcpBridge.runGit(folder.uri.fsPath, ['remote', '-v']);
					const remotes = [...new Set(
						rawRemotes
							.split(/\r?\n/)
							.map(line => line.trim())
							.filter(Boolean)
							.map(line => line.split(/\s+/)[1])
							.filter(Boolean),
					)];

					repos.push({
						name: folder.name,
						path: folder.uri.fsPath,
						remotes,
					});
				} catch {
					repos.push({
						name: folder.name,
						path: folder.uri.fsPath,
						remotes: [],
					});
				}
			}

			return {
				content: [{
					type: 'text' as const,
					text: JSON.stringify(repos, null, 2),
				}],
			};
		},
	);
}
