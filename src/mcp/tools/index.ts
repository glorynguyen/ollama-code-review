import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerReviewTools } from './reviewTools';
import { registerContextTools } from './contextTools';
import { registerCommitTools } from './commitTools';
import { registerUtilityTools } from './scoreTools';
import { registerBrowserTools } from './browserTools';
import { registerImpactTools } from './impactTools';
import { registerFileTools } from './fileTools';

/**
 * Register all MCP tools on the server.
 * All tools return raw data only — no AI provider calls.
 */
export function registerAllTools(server: McpServer): void {
	registerReviewTools(server);       // get_staged_diff, get_commit_diff, get_file_content, get_branch_diff
	registerContextTools(server);      // get_review_context, get_review_prompt, *_review_bundle tools
	registerCommitTools(server);       // get_commit_prompt, get_commit_prompt_bundle
	registerUtilityTools(server);      // score_review, parse_findings, list_profiles, get_config
	registerBrowserTools(server);      // get_workspace_repos
	registerImpactTools(server);       // get_impacted_files (Phase 3: Impact Graph Agent)
	registerFileTools(server);         // write_file, update_file, delete_file
}
