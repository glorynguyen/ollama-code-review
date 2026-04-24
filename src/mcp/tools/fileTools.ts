import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpBridge } from '../context';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveAndValidatePath } from '../../utils/pathValidation';

/**
 * Register file system editing tools.
 * These allow the AI to create, update, and delete files in the workspace.
 */
export function registerFileTools(server: McpServer): void {

	server.registerTool(
		'write_file',
		{
			description: 'Create a new file or overwrite an existing file with the provided content.',
			inputSchema: {
				file_path: z.string().describe('Absolute or workspace-relative path to the file'),
				content: z.string().describe('The complete content to write to the file'),
			},
		},
		async ({ file_path, content }) => {
			mcpBridge.log(`write_file: path=${file_path}`);

			try {
				const repoPath = mcpBridge.getWorkspaceRoots();
				const validation = await resolveAndValidatePath(file_path, repoPath);
				if (!validation.valid) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${validation.error}` }],
						isError: true,
					};
				}
				const { resolvedPath } = validation;

				// Ensure directory exists
				await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

				await fs.writeFile(resolvedPath, content, 'utf-8');

				return {
					content: [{ type: 'text' as const, text: `Successfully wrote to ${file_path}` }],
				};
			} catch (error: any) {
				return {
					content: [{ type: 'text' as const, text: `Error writing file: ${error?.message || String(error)}` }],
					isError: true,
				};
			}
		},
	);

	server.registerTool(
		'update_file',
		{
			description: 'Update an existing file with the provided content. Fails if the file does not exist.',
			inputSchema: {
				file_path: z.string().describe('Absolute or workspace-relative path to the file'),
				content: z.string().describe('The new complete content for the file'),
			},
		},
		async ({ file_path, content }) => {
			mcpBridge.log(`update_file: path=${file_path}`);

			try {
				const repoPath = mcpBridge.getWorkspaceRoots();
				const validation = await resolveAndValidatePath(file_path, repoPath);
				if (!validation.valid) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${validation.error}` }],
						isError: true,
					};
				}
				const { resolvedPath } = validation;

				// Open with 'r+' — fails atomically with ENOENT if file doesn't exist,
				// eliminating the TOCTOU race between an access() check and writeFile().
				let handle: fs.FileHandle | undefined;
				try {
					handle = await fs.open(resolvedPath, 'r+');
					await handle.truncate(0);
					await handle.writeFile(content, 'utf-8');
				} catch (err: any) {
					if (err.code === 'ENOENT') {
						return {
							content: [{ type: 'text' as const, text: `Error: File does not exist: ${file_path}` }],
							isError: true,
						};
					}
					throw err;
				} finally {
					await handle?.close();
				}

				return {
					content: [{ type: 'text' as const, text: `Successfully updated ${file_path}` }],
				};
			} catch (error: any) {
				return {
					content: [{ type: 'text' as const, text: `Error updating file: ${error?.message || String(error)}` }],
					isError: true,
				};
			}
		},
	);

	server.registerTool(
		'delete_file',
		{
			description: 'Delete a file from the workspace.',
			inputSchema: {
				file_path: z.string().describe('Absolute or workspace-relative path to the file to delete'),
			},
		},
		async ({ file_path }) => {
			mcpBridge.log(`delete_file: path=${file_path}`);

			try {
				const repoPath = mcpBridge.getWorkspaceRoots();
				const validation = await resolveAndValidatePath(file_path, repoPath);
				if (!validation.valid) {
					return {
						content: [{ type: 'text' as const, text: `Error: ${validation.error}` }],
						isError: true,
					};
				}
				const { resolvedPath } = validation;

				// Verify the file exists before attempting deletion so the user
				// isn't prompted for confirmation only to see an error.
				try {
					await fs.access(resolvedPath);
				} catch {
					return {
						content: [{ type: 'text' as const, text: `Error: File does not exist: ${file_path}` }],
						isError: true,
					};
				}

				await fs.unlink(resolvedPath);

				return {
					content: [{ type: 'text' as const, text: `Successfully deleted ${file_path}` }],
				};
			} catch (error: any) {
				return {
					content: [{ type: 'text' as const, text: `Error deleting file: ${error?.message || String(error)}` }],
					isError: true,
				};
			}
		},
	);
}


