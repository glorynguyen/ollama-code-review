import * as fs from 'fs/promises';
import * as path from 'path';
import { mcpBridge } from './context';
import type { SembleIndexResult, SembleStatusResult } from './sembleService';

export interface IndexedCodebase {
	repositoryPath: string;
	name: string;
	chunkCount?: number;
	indexedAt: string;
	lastUsedAt?: string;
}

export interface CodebaseResolution {
	selectedRepositoryPath?: string;
	reason: 'exact-match' | 'cwd-inside-indexed-repo' | 'unique-child-match' | 'ambiguous' | 'no-match' | 'no-indexed-codebases';
	needsUserSelection: boolean;
	candidates: IndexedCodebase[];
}

const REGISTRY_FILE = 'code-search-indexes.json';

function pathKey(filePath: string): string {
	return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}

function isSameOrInside(childPath: string, parentPath: string): boolean {
	const child = pathKey(path.resolve(childPath));
	const parent = pathKey(path.resolve(parentPath));
	return child === parent || child.startsWith(parent + path.sep);
}

function codebaseName(repositoryPath: string): string {
	return path.basename(repositoryPath) || repositoryPath;
}

export class CodeSearchRegistry {
	async list(): Promise<IndexedCodebase[]> {
		const entries = await this.read();
		return entries.sort((a, b) => a.name.localeCompare(b.name) || a.repositoryPath.localeCompare(b.repositoryPath));
	}

	async upsertFromIndex(result: SembleIndexResult): Promise<IndexedCodebase> {
		return this.upsert({
			repositoryPath: result.repositoryPath,
			name: codebaseName(result.repositoryPath),
			chunkCount: result.chunkCount,
			indexedAt: result.indexedAt,
			lastUsedAt: new Date().toISOString(),
		});
	}

	async upsertFromStatus(status: SembleStatusResult): Promise<void> {
		for (const index of status.indexes) {
			await this.upsert({
				repositoryPath: index.repositoryPath,
				name: codebaseName(index.repositoryPath),
				chunkCount: index.chunkCount,
				indexedAt: index.indexedAt,
			});
		}
	}

	async markUsed(repositoryPath: string): Promise<void> {
		const registered = await this.resolveRegisteredPath(repositoryPath);
		if (!registered) {
			return;
		}
		const entries = await this.read();
		const next = entries.map(entry => entry.repositoryPath === registered
			? { ...entry, lastUsedAt: new Date().toISOString() }
			: entry);
		await this.write(next);
	}

	async resolveRegisteredPath(repositoryPath: string): Promise<string | undefined> {
		const normalized = await this.normalizeExistingPath(repositoryPath);
		const entries = await this.read();
		return entries.find(entry => pathKey(entry.repositoryPath) === pathKey(normalized))?.repositoryPath;
	}

	async resolveForWorkingDirectory(workingDirectory: string): Promise<CodebaseResolution> {
		const entries = await this.list();
		if (entries.length === 0) {
			return {
				reason: 'no-indexed-codebases',
				needsUserSelection: true,
				candidates: [],
			};
		}

		const normalizedWorkingDirectory = await this.normalizeExistingPath(workingDirectory);
		const exact = entries.find(entry => pathKey(entry.repositoryPath) === pathKey(normalizedWorkingDirectory));
		if (exact) {
			return {
				selectedRepositoryPath: exact.repositoryPath,
				reason: 'exact-match',
				needsUserSelection: false,
				candidates: [exact],
			};
		}

		const ancestors = entries
			.filter(entry => isSameOrInside(normalizedWorkingDirectory, entry.repositoryPath))
			.sort((a, b) => b.repositoryPath.length - a.repositoryPath.length);

		if (ancestors.length > 0) {
			return {
				selectedRepositoryPath: ancestors[0].repositoryPath,
				reason: 'cwd-inside-indexed-repo',
				needsUserSelection: false,
				candidates: ancestors,
			};
		}

		const children = entries.filter(entry => isSameOrInside(entry.repositoryPath, normalizedWorkingDirectory));
		if (children.length === 1) {
			return {
				selectedRepositoryPath: children[0].repositoryPath,
				reason: 'unique-child-match',
				needsUserSelection: false,
				candidates: children,
			};
		}
		if (children.length > 1) {
			return {
				reason: 'ambiguous',
				needsUserSelection: true,
				candidates: children,
			};
		}

		return {
			reason: 'no-match',
			needsUserSelection: true,
			candidates: entries,
		};
	}

	private async upsert(entry: IndexedCodebase): Promise<IndexedCodebase> {
		const normalizedPath = await this.normalizeExistingPath(entry.repositoryPath);
		const entries = await this.read();
		const existing = entries.find(item => pathKey(item.repositoryPath) === pathKey(normalizedPath));
		const nextEntry: IndexedCodebase = {
			...existing,
			...entry,
			repositoryPath: normalizedPath,
			name: entry.name || existing?.name || codebaseName(normalizedPath),
		};

		const next = [
			...entries.filter(item => pathKey(item.repositoryPath) !== pathKey(normalizedPath)),
			nextEntry,
		];
		await this.write(next);
		return nextEntry;
	}

	private async read(): Promise<IndexedCodebase[]> {
		try {
			const text = await fs.readFile(this.registryPath(), 'utf8');
			const parsed = JSON.parse(text) as unknown;
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed
				.filter((entry): entry is IndexedCodebase => this.isIndexedCodebase(entry))
				.map(entry => ({
					...entry,
					name: entry.name || codebaseName(entry.repositoryPath),
				}));
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			mcpBridge.log(`code search registry read failed: ${String(err)}`);
			return [];
		}
	}

	private async write(entries: IndexedCodebase[]): Promise<void> {
		const filePath = this.registryPath();
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf8');
	}

	private registryPath(): string {
		return path.join(mcpBridge.getGlobalStoragePath(), 'mcp', REGISTRY_FILE);
	}

	private async normalizeExistingPath(filePath: string): Promise<string> {
		return fs.realpath(filePath).catch(() => path.resolve(filePath));
	}

	private isIndexedCodebase(value: unknown): value is IndexedCodebase {
		if (!value || typeof value !== 'object') {
			return false;
		}
		const candidate = value as Partial<IndexedCodebase>;
		return typeof candidate.repositoryPath === 'string'
			&& typeof candidate.indexedAt === 'string';
	}
}

export const codeSearchRegistry = new CodeSearchRegistry();
