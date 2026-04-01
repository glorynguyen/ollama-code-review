import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReviewTools } from './reviewTools';
import { registerContextTools } from './contextTools';
import { registerCommitTools } from './commitTools';
import { registerUtilityTools } from './scoreTools';

/**
 * Register all MCP tools on the server.
 * All tools return raw data only — no AI provider calls.
 */
export function registerAllTools(server: McpServer): void {
	registerReviewTools(server);       // get_staged_diff, get_commit_diff, get_file_content
	registerContextTools(server);      // get_review_context, get_review_prompt
	registerCommitTools(server);       // get_commit_prompt
	registerUtilityTools(server);      // score_review, parse_findings, list_profiles, get_config
}
