/**
 * Phase 1: Dependency Registry (Impact Graph Agent)
 * 
 * Maintains a reverse dependency map (Who imports this file?) to enable
 * autonomous impact analysis.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { parseImports } from './importParser';
import { resolveImport, toRelativePath } from './fileResolver';

export class DependencyRegistry {
	private static instance: DependencyRegistry;
	
	// Map<ResolvedFilePath, Set<ImporterRelativePath>>
	private reverseMap = new Map<string, Set<string>>();

	// Map<ImporterRelativePath, Set<ResolvedFilePath>> (Forward map for O(1) cleanup)
	private forwardMap = new Map<string, Set<string>>();
	
	private isIndexing = false;
	private outputChannel?: vscode.OutputChannel;

	private constructor() {}

	public static getInstance(): DependencyRegistry {
		if (!DependencyRegistry.instance) {
			DependencyRegistry.instance = new DependencyRegistry();
		}
		return DependencyRegistry.instance;
	}

	public setOutputChannel(channel: vscode.OutputChannel) {
		this.outputChannel = channel;
	}

	/**
	 * Perform a full (but lazy) workspace scan to build the initial map.
	 * Runs in the background to avoid blocking the extension host.
	 */
	public async indexWorkspace(): Promise<void> {
		if (this.isIndexing) { return; }
		this.isIndexing = true;
		this.log('Starting dependency indexing...');

		const startTime = Date.now();
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) { 
			this.isIndexing = false;
			return; 
		}

		try {
			const files = await vscode.workspace.findFiles(
				'**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}',
				'**/{node_modules,dist,build,out,.next,coverage}/**'
			);

			this.log(`Found ${files.length} files to index.`);

			// Use a smaller batch size and longer pause to be gentler on Disk I/O
			const batchSize = 20;
			for (let i = 0; i < files.length; i += batchSize) {
				const batch = files.slice(i, i + batchSize);
				await Promise.all(batch.map(uri => this.indexFile(uri)));
				
				// Yield to event loop to prevent starvation
				await new Promise(resolve => setTimeout(resolve, 50));
			}

			const duration = ((Date.now() - startTime) / 1000).toFixed(2);
			this.log(`Indexing complete in ${duration}s. Indexed ${files.length} files.`);
		} catch (err) {
			this.log(`Indexing failed: ${err}`);
		} finally {
			this.isIndexing = false;
		}
	}

	/**
	 * Index a single file and update the maps.
	 */
	public async indexFile(uri: vscode.Uri): Promise<void> {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspaceFolder) { return; }

		try {
			const content = await this.readFile(uri);
			if (!content) { return; }

			const importerPath = toRelativePath(uri, workspaceFolder.uri);
			const imports = parseImports(content);

			for (const imp of imports) {
				if (imp.isRelative) {
					const resolvedUri = await resolveImport(imp.specifier, importerPath, workspaceFolder.uri);
					if (resolvedUri) {
						const resolvedPath = toRelativePath(resolvedUri, workspaceFolder.uri);
						this.addDependency(resolvedPath, importerPath);
					}
				}
			}
		} catch (err) {
			// Fail silently for individual files
		}
	}

	/**
	 * Update the map when a file is saved.
	 */
	public async handleFileSave(uri: vscode.Uri): Promise<void> {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspaceFolder) { return; }

		const relativePath = toRelativePath(uri, workspaceFolder.uri);
		
		// O(K) cleanup using the forward map
		this.removeImporter(relativePath);
		
		// Re-index the file
		await this.indexFile(uri);
	}

	/**
	 * Get all files that import the given file.
	 */
	public getImporters(filePath: string): string[] {
		const importers = this.reverseMap.get(filePath);
		return importers ? Array.from(importers) : [];
	}

	private addDependency(resolvedPath: string, importerPath: string) {
		// Update reverse map
		if (!this.reverseMap.has(resolvedPath)) {
			this.reverseMap.set(resolvedPath, new Set());
		}
		this.reverseMap.get(resolvedPath)!.add(importerPath);

		// Update forward map
		if (!this.forwardMap.has(importerPath)) {
			this.forwardMap.set(importerPath, new Set());
		}
		this.forwardMap.get(importerPath)!.add(resolvedPath);
	}

	private removeImporter(importerPath: string) {
		const dependencies = this.forwardMap.get(importerPath);
		if (dependencies) {
			for (const dep of dependencies) {
				const importers = this.reverseMap.get(dep);
				if (importers) {
					importers.delete(importerPath);
					// Cleanup empty sets to save memory
					if (importers.size === 0) {
						this.reverseMap.delete(dep);
					}
				}
			}
			this.forwardMap.delete(importerPath);
		}
	}

	private async readFile(uri: vscode.Uri): Promise<string | undefined> {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			return Buffer.from(bytes).toString('utf-8');
		} catch {
			return undefined;
		}
	}

	private log(message: string) {
		if (this.outputChannel) {
			this.outputChannel.appendLine(`[DependencyRegistry] ${message}`);
		}
	}
}
