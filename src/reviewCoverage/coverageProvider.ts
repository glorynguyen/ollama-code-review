import * as path from 'path';
import * as vscode from 'vscode';
import type { FindingCounts } from '../notifications';
import type { ReviewScore } from '../reviewScore';
import { ReviewScoreStore } from '../reviewScore';

export interface CoverageConfig {
	includeGlob: string;
	excludeGlob: string;
	staleAfterDays: number;
	maxFiles: number;
}

export type CoverageGroupId = 'never' | 'stale' | 'findings' | 'recent';

export interface CoverageFileItem {
	relativePath: string;
	uri: vscode.Uri;
	group: CoverageGroupId;
	lastReview?: ReviewScore;
	lastReviewedAt?: Date;
	ageDays?: number;
	score?: number;
	findingCounts?: FindingCounts;
}

interface CoverageGroup {
	id: CoverageGroupId;
	label: string;
	description: string;
	icon: vscode.ThemeIcon;
	items: CoverageFileItem[];
}

export class CoverageGroupNode {
	constructor(public readonly group: CoverageGroup) {}
}

export class CoverageFileNode {
	constructor(public readonly item: CoverageFileItem) {}
}

export type CoverageTreeElement = CoverageGroupNode | CoverageFileNode;

const GROUP_META: Record<CoverageGroupId, Omit<CoverageGroup, 'items' | 'description'>> = {
	never: {
		id: 'never',
		label: 'Never Reviewed',
		icon: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('list.warningForeground')),
	},
	stale: {
		id: 'stale',
		label: 'Stale',
		icon: new vscode.ThemeIcon('history', new vscode.ThemeColor('list.warningForeground')),
	},
	findings: {
		id: 'findings',
		label: 'Reviewed With Findings',
		icon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
	},
	recent: {
		id: 'recent',
		label: 'Recently Reviewed',
		icon: new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green')),
	},
};

const GROUP_ORDER: CoverageGroupId[] = ['never', 'stale', 'findings', 'recent'];

export function getCoverageConfig(): CoverageConfig {
	const cfg = vscode.workspace.getConfiguration('ollama-code-review.coverage');
	return {
		includeGlob: cfg.get<string>('includeGlob', '**/*.{ts,js,tsx,jsx,py,java,cs,go,rb,php,rs,swift,kt,vue,svelte,c,cpp,h}'),
		excludeGlob: cfg.get<string>('excludeGlob', '**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/coverage/**,**/*.min.js,**/*.d.ts'),
		staleAfterDays: Math.max(1, cfg.get<number>('staleAfterDays', 14)),
		maxFiles: Math.max(10, cfg.get<number>('maxFiles', 1000)),
	};
}

export function computeReviewCoverage(
	files: readonly { relativePath: string; uri: vscode.Uri }[],
	scores: readonly ReviewScore[],
	staleAfterDays: number,
	now = new Date(),
): CoverageFileItem[] {
	const latestByFile = new Map<string, ReviewScore>();

	for (const score of scores) {
		const reviewedFiles = extractReviewedFiles(score);
		if (reviewedFiles.length === 0) {
			continue;
		}

		const timestamp = new Date(score.timestamp).getTime();
		if (!Number.isFinite(timestamp)) {
			continue;
		}

		for (const filePath of reviewedFiles) {
			const key = normalizePath(filePath);
			const existing = latestByFile.get(key);
			if (!existing || new Date(existing.timestamp).getTime() < timestamp) {
				latestByFile.set(key, score);
			}
		}
	}

	return files
		.map(file => {
			const relativePath = normalizePath(file.relativePath);
			const lastReview = latestByFile.get(relativePath);
			if (!lastReview) {
				return {
					relativePath,
					uri: file.uri,
					group: 'never' as CoverageGroupId,
				};
			}

			const lastReviewedAt = new Date(lastReview.timestamp);
			const ageDays = Math.max(0, Math.floor((now.getTime() - lastReviewedAt.getTime()) / (24 * 60 * 60 * 1000)));
			const hasFindings = hasActionableFindings(lastReview.findingCounts);
			const group: CoverageGroupId = ageDays >= staleAfterDays
				? 'stale'
				: hasFindings
					? 'findings'
					: 'recent';

			return {
				relativePath,
				uri: file.uri,
				group,
				lastReview,
				lastReviewedAt,
				ageDays,
				score: lastReview.score,
				findingCounts: lastReview.findingCounts,
			};
		})
		.sort((a, b) => compareCoverageItems(a, b));
}

export class ReviewCoverageProvider implements vscode.TreeDataProvider<CoverageTreeElement> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<CoverageTreeElement | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private groups: CoverageGroup[] = buildEmptyGroups();
	private isRefreshing = false;

	constructor(private readonly globalStoragePathProvider: () => string | undefined) {}

	async refresh(): Promise<void> {
		if (this.isRefreshing) {
			return;
		}

		this.isRefreshing = true;
		try {
			const config = getCoverageConfig();
			const files = await this.findWorkspaceFiles(config);
			const storagePath = this.globalStoragePathProvider();
			const scores = storagePath ? ReviewScoreStore.getInstance(storagePath).getAllScores() : [];
			const items = computeReviewCoverage(files, scores, config.staleAfterDays);
			this.groups = buildGroups(items);
		} finally {
			this.isRefreshing = false;
			this._onDidChangeTreeData.fire();
		}
	}

	getTreeItem(element: CoverageTreeElement): vscode.TreeItem {
		if (element instanceof CoverageGroupNode) {
			const item = new vscode.TreeItem(
				element.group.label,
				element.group.items.length > 0
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.Collapsed,
			);
			item.iconPath = element.group.icon;
			item.description = element.group.description;
			item.contextValue = 'coverageGroup';
			return item;
		}

		const coverage = element.item;
		const item = new vscode.TreeItem(path.basename(coverage.relativePath), vscode.TreeItemCollapsibleState.None);
		item.resourceUri = coverage.uri;
		item.description = this.describeFile(coverage);
		item.tooltip = this.buildTooltip(coverage);
		item.contextValue = coverage.lastReview ? 'coverageFileReviewed' : 'coverageFileNever';
		item.command = {
			command: 'ollama-code-review.openCoverageFile',
			title: 'Open File',
			arguments: [coverage.uri],
		};
		item.iconPath = this.getFileIcon(coverage);
		return item;
	}

	getChildren(element?: CoverageTreeElement): CoverageTreeElement[] {
		if (!element) {
			return this.groups.map(group => new CoverageGroupNode(group));
		}
		if (element instanceof CoverageGroupNode) {
			return element.group.items.map(item => new CoverageFileNode(item));
		}
		return [];
	}

	getFileItem(element: unknown): CoverageFileItem | undefined {
		return element instanceof CoverageFileNode ? element.item : undefined;
	}

	getSummaryMarkdown(): string {
		const total = this.groups.reduce((sum, group) => sum + group.items.length, 0);
		const lines = [
			'# Review Coverage',
			'',
			`Total tracked files: ${total}`,
			'',
		];

		for (const group of this.groups) {
			lines.push(`## ${group.label} (${group.items.length})`, '');
			if (group.items.length === 0) {
				lines.push('- None', '');
				continue;
			}
			for (const item of group.items) {
				lines.push(`- ${item.relativePath}${item.lastReview ? ` - ${this.describeFile(item)}` : ''}`);
			}
			lines.push('');
		}

		return lines.join('\n');
	}

	private async findWorkspaceFiles(config: CoverageConfig): Promise<Array<{ relativePath: string; uri: vscode.Uri }>> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return [];
		}

		const files: Array<{ relativePath: string; uri: vscode.Uri }> = [];
		for (const folder of workspaceFolders) {
			const pattern = new vscode.RelativePattern(folder, config.includeGlob);
			const found = await vscode.workspace.findFiles(pattern, toBraceExclude(config.excludeGlob), config.maxFiles);
			for (const uri of found) {
				files.push({
					relativePath: normalizePath(vscode.workspace.asRelativePath(uri, false)),
					uri,
				});
			}
		}

		const unique = new Map<string, { relativePath: string; uri: vscode.Uri }>();
		for (const file of files) {
			if (!unique.has(file.relativePath)) {
				unique.set(file.relativePath, file);
			}
		}
		return Array.from(unique.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	}

	private describeFile(item: CoverageFileItem): string {
		if (!item.lastReview) {
			return 'not reviewed';
		}

		const age = item.ageDays === 0 ? 'today' : `${item.ageDays}d ago`;
		const score = typeof item.score === 'number' ? `score ${item.score}` : 'score n/a';
		const findings = formatFindingCounts(item.findingCounts);
		return findings ? `${age}, ${score}, ${findings}` : `${age}, ${score}`;
	}

	private buildTooltip(item: CoverageFileItem): vscode.MarkdownString {
		const markdown = new vscode.MarkdownString(undefined, true);
		markdown.appendMarkdown(`**${item.relativePath}**\n\n`);
		if (!item.lastReview) {
			markdown.appendMarkdown('Never reviewed by Ollama Code Review.');
			return markdown;
		}

		markdown.appendMarkdown(`Last reviewed: ${item.lastReviewedAt?.toLocaleString() ?? item.lastReview.timestamp}\n\n`);
		markdown.appendMarkdown(`Score: ${item.score ?? 'n/a'}\n\n`);
		const findings = formatFindingCounts(item.findingCounts);
		if (findings) {
			markdown.appendMarkdown(`Findings: ${findings}\n\n`);
		}
		markdown.appendMarkdown(`Review type: ${item.lastReview.reviewType ?? 'unknown'}\n\n`);
		markdown.appendMarkdown(`Model: ${item.lastReview.model}`);
		return markdown;
	}

	private getFileIcon(item: CoverageFileItem): vscode.ThemeIcon {
		if (!item.lastReview) {
			return new vscode.ThemeIcon('circle-slash');
		}
		if (item.group === 'stale') {
			return new vscode.ThemeIcon('history');
		}
		if (item.group === 'findings') {
			return new vscode.ThemeIcon('warning');
		}
		return new vscode.ThemeIcon('check');
	}
}

function extractReviewedFiles(score: ReviewScore): string[] {
	if (score.filesReviewed && score.filesReviewed.length > 0) {
		return score.filesReviewed.map(normalizePath);
	}

	if (score.reviewType === 'file' && score.label) {
		const match = /^\[File Review: (.+)]$/.exec(score.label);
		if (match) {
			return [normalizePath(match[1])];
		}
	}

	return [];
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function hasActionableFindings(counts: FindingCounts | undefined): boolean {
	if (!counts) {
		return false;
	}
	return counts.critical + counts.high + counts.medium + counts.low > 0;
}

function compareCoverageItems(a: CoverageFileItem, b: CoverageFileItem): number {
	const ageDiff = (b.ageDays ?? Number.MAX_SAFE_INTEGER) - (a.ageDays ?? Number.MAX_SAFE_INTEGER);
	if (ageDiff !== 0) {
		return ageDiff;
	}

	const scoreDiff = (a.score ?? 101) - (b.score ?? 101);
	if (scoreDiff !== 0) {
		return scoreDiff;
	}

	return a.relativePath.localeCompare(b.relativePath);
}

function buildEmptyGroups(): CoverageGroup[] {
	return GROUP_ORDER.map(id => ({
		...GROUP_META[id],
		description: '0 files',
		items: [],
	}));
}

function buildGroups(items: CoverageFileItem[]): CoverageGroup[] {
	return GROUP_ORDER.map(id => {
		const groupItems = items.filter(item => item.group === id);
		return {
			...GROUP_META[id],
			description: `${groupItems.length} file${groupItems.length === 1 ? '' : 's'}`,
			items: groupItems,
		};
	});
}

function formatFindingCounts(counts: FindingCounts | undefined): string {
	if (!counts) {
		return '';
	}

	const parts = [
		counts.critical > 0 ? `${counts.critical} critical` : '',
		counts.high > 0 ? `${counts.high} high` : '',
		counts.medium > 0 ? `${counts.medium} medium` : '',
		counts.low > 0 ? `${counts.low} low` : '',
	].filter(Boolean);
	return parts.join(', ');
}

function toBraceExclude(excludeGlob: string): string {
	const patterns = excludeGlob
		.split(',')
		.map(part => part.trim())
		.filter(Boolean);
	if (patterns.length === 0) {
		return '';
	}
	return patterns.length === 1 ? patterns[0] : `{${patterns.join(',')}}`;
}
