import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as vscode from 'vscode';
import { mcpBridge } from '../context';
import { parseFindingCounts, computeScore } from '../../reviewScore';
import { parseReviewIntoFindings } from '../../github/commentMapper';
import { getAllProfiles } from '../../profiles';

export function registerUtilityTools(server: McpServer): void {

	server.registerTool(
		'score_review',
		{
			description: 'Compute a quality score (0-100) from a code review text. Parses finding severities and returns score breakdown. Pure computation — no AI calls.',
			inputSchema: {
				review_text: z.string().describe('The review text (Markdown) to score'),
			},
		},
		async ({ review_text }) => {
			mcpBridge.log('score_review');

			const counts = parseFindingCounts(review_text);
			const result = computeScore(counts);

			const output = [
				`## Review Quality Score: ${result.score}/100`,
				'',
				'### Finding Counts',
				`- Critical: ${counts.critical}`,
				`- High: ${counts.high}`,
				`- Medium: ${counts.medium}`,
				`- Low: ${counts.low}`,
				`- Info: ${counts.info}`,
				'',
				'### Sub-Scores',
				`- Correctness: ${result.correctness}/100`,
				`- Security: ${result.security}/100`,
				`- Maintainability: ${result.maintainability}/100`,
				`- Performance: ${result.performance}/100`,
			].join('\n');

			return { content: [{ type: 'text' as const, text: output }] };
		},
	);

	server.registerTool(
		'parse_findings',
		{
			description: 'Parse a code review into structured findings with file, line, severity, and message. Pure computation — no AI calls.',
			inputSchema: {
				review_text: z.string().describe('The review text (Markdown) to parse'),
				diff: z.string().optional().describe('Optional diff for file/line matching'),
			},
		},
		async ({ review_text, diff }) => {
			mcpBridge.log('parse_findings');

			const findings = parseReviewIntoFindings(review_text, diff || '');

			const output = JSON.stringify(findings.map(f => ({
				severity: f.severity,
				message: f.message,
				file: f.file || null,
				line: f.line || null,
				suggestion: f.suggestion || null,
			})), null, 2);

			return { content: [{ type: 'text' as const, text: output }] };
		},
	);

	server.registerTool(
		'list_profiles',
		{
			description: 'List all available review profiles (built-in + custom + compliance). Returns profile names, descriptions, and focus areas.',
			inputSchema: undefined,
		},
		async () => {
			mcpBridge.log('list_profiles');

			const profiles = getAllProfiles(mcpBridge.context);
			const output = profiles.map(p => ({
				name: p.name,
				description: p.description,
				focusAreas: p.focusAreas,
				severity: p.severity,
				group: p.group || 'built-in',
			}));

			return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
		},
	);

	server.registerTool(
		'get_repo_config',
		{
			description: 'Get repository-scoped extension configuration values used by local tooling, such as the default base branch for branch comparison.',
			inputSchema: {
				repository_path: z.string().describe('Absolute path to the local repository/workspace folder.'),
			},
		},
		async ({ repository_path }) => {
			mcpBridge.log(`get_repo_config: repo=${repository_path}`);

			const config = mcpBridge.getConfig(vscode.Uri.file(repository_path));
			const exported = {
				defaultBaseBranch: config.get('defaultBaseBranch'),
			};

			return { content: [{ type: 'text' as const, text: JSON.stringify(exported, null, 2) }] };
		},
	);

	server.registerTool(
		'get_config',
		{
			description: 'Get the current extension configuration (model, endpoint, frameworks, diff filter settings, etc.).',
			inputSchema: undefined,
		},
		async () => {
			mcpBridge.log('get_config');

			const config = mcpBridge.getConfig();
			const exported = {
				model: config.get('model'),
				customModel: config.get('customModel'),
				endpoint: config.get('endpoint'),
				temperature: config.get('temperature'),
				frameworks: config.get('frameworks'),
				diffFilter: config.get('diffFilter'),
				contextGathering: config.get('contextGathering'),
				knowledgeBase: config.get('knowledgeBase'),
				agentMode: config.get('agentMode'),
				mcp: {
					enabled: config.get('mcp.enabled'),
					port: config.get('mcp.port'),
					autoKillPortConflicts: config.get('mcp.autoKillPortConflicts'),
					allowedOrigins: config.get('mcp.allowedOrigins'),
					authTokenConfigured: !!config.get('mcp.authToken'),
				},
			};

			return { content: [{ type: 'text' as const, text: JSON.stringify(exported, null, 2) }] };
		},
	);
}
