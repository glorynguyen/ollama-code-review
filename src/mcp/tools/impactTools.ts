import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DependencyRegistry } from '../../context/dependencyRegistry';

/**
 * Register Impact Analysis tools for the MCP server.
 * Enables agents to autonomously discover downstream consumers of modified code.
 */
export function registerImpactTools(server: McpServer): void {
	server.tool(
		"get_impacted_files",
		"Identify files that import the given file. Used for impact analysis and cross-file bug detection.",
		{
			filePath: z.string().describe("Relative path to the modified file (e.g., 'src/utils.ts')")
		},
		async ({ filePath }) => {
			const registry = DependencyRegistry.getInstance();
			const importers = registry.getImporters(filePath);
			
			if (importers.length === 0) {
				return {
					content: [{ type: "text", text: `No downstream consumers found for ${filePath}.` }]
				};
			}

			return {
				content: [{ 
					type: "text", 
					text: `The file '${filePath}' is imported by the following ${importers.length} file(s):\n- ` + 
						  importers.join("\n- ") + 
						  "\n\nYou should analyze these files to ensure they are compatible with any changes made to the exports."
				}]
			};
		}
	);
}
