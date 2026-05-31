/**
 * F-050: Code Health Regression Guard — Tree View Provider
 *
 * Displays code health hotspots in a sidebar tree view, grouped by health tier.
 * Files with the worst scores and regressions are surfaced prominently.
 */

import * as vscode from 'vscode';
import { ReviewScoreStore } from '../reviewScore';
import type { FileHealthSummary, CodeHealthConfig } from './types';
import { getCodeHealthConfig, getHotspots } from './tracker';

// ─── Tree item types ─────────────────────────────────────────────────────────

type HealthTierId = 'critical' | 'warning' | 'healthy';

interface HealthTierGroup {
	id: HealthTierId;
	label: string;
	icon: vscode.ThemeIcon;
	items: FileHealthSummary[];
}

class TierNode {
	constructor(public readonly group: HealthTierGroup) {}
}

class FileHealthNode {
	constructor(public readonly summary: FileHealthSummary) {}
}

type TreeElement = TierNode | FileHealthNode;

// ─── Tier metadata ───────────────────────────────────────────────────────────

const TIER_META: Record<HealthTierId, Omit<HealthTierGroup, 'items'>> = {
	critical: {
		id: 'critical',
		label: 'Critical Health',
		icon: new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground')),
	},
	warning: {
		id: 'warning',
		label: 'Needs Attention',
		icon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
	},
	healthy: {
		id: 'healthy',
		label: 'Healthy',
		icon: new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green')),
	},
};

const TIER_ORDER: HealthTierId[] = ['critical', 'warning', 'healthy'];

function getTier(score: number): HealthTierId {
	if (score < 60) { return 'critical'; }
	if (score < 80) { return 'warning'; }
	return 'healthy';
}

// ─── TreeDataProvider ────────────────────────────────────────────────────────

export class CodeHealthTreeProvider implements vscode.TreeDataProvider<TreeElement> {
	private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private _tiers: HealthTierGroup[] = [];
	private _hotspots: FileHealthSummary[] = [];

	constructor(private readonly _getGlobalStoragePath: () => string | undefined) {}

	refresh(): void {
		this._buildTiers();
		this._onDidChangeTreeData.fire();
	}

	getHotspots(): readonly FileHealthSummary[] {
		return this._hotspots;
	}

	getSummaryMarkdown(): string {
		if (this._hotspots.length === 0) {
			return '# Code Health\n\nNo review data available yet.';
		}

		const lines: string[] = ['# Code Health Hotspots', ''];
		lines.push(`| File | Score | Trend | Reviews |`);
		lines.push(`|------|-------|-------|---------|`);

		for (const h of this._hotspots) {
			const trend = h.delta !== undefined
				? (h.delta >= 0 ? `↑${h.delta}` : `↓${Math.abs(h.delta)}`)
				: '—';
			lines.push(`| ${h.filePath} | ${h.currentScore}/100 | ${trend} | ${h.reviewCount} |`);
		}

		return lines.join('\n');
	}

	private _buildTiers(): void {
		const storagePath = this._getGlobalStoragePath();
		if (!storagePath) {
			this._tiers = [];
			this._hotspots = [];
			return;
		}

		const config = getCodeHealthConfig();
		const store = ReviewScoreStore.getInstance(storagePath);
		const scores = store.getAllScores();
		this._hotspots = getHotspots(scores, config.hotspotCount);

		// Group hotspots into tiers
		const tierMap: Record<HealthTierId, FileHealthSummary[]> = {
			critical: [],
			warning: [],
			healthy: [],
		};

		for (const summary of this._hotspots) {
			tierMap[getTier(summary.currentScore)].push(summary);
		}

		this._tiers = TIER_ORDER
			.map(id => ({
				...TIER_META[id],
				items: tierMap[id],
			}))
			.filter(tier => tier.items.length > 0);
	}

	// ── TreeDataProvider interface ───────────────────────────────────

	getTreeItem(element: TreeElement): vscode.TreeItem {
		if (element instanceof TierNode) {
			const item = new vscode.TreeItem(
				element.group.label,
				vscode.TreeItemCollapsibleState.Expanded,
			);
			item.iconPath = element.group.icon;
			item.description = `${element.group.items.length} file${element.group.items.length !== 1 ? 's' : ''}`;
			item.contextValue = 'healthTier';
			return item;
		}

		// FileHealthNode
		const summary = element.summary;
		const item = new vscode.TreeItem(
			summary.filePath,
			vscode.TreeItemCollapsibleState.None,
		);

		// Score badge with trend
		const trendStr = summary.delta !== undefined
			? (summary.delta >= 0 ? ` ↑${summary.delta}` : ` ↓${Math.abs(summary.delta)}`)
			: '';
		item.description = `${summary.currentScore}/100${trendStr}`;

		// Icon based on tier
		const tier = getTier(summary.currentScore);
		item.iconPath = TIER_META[tier].icon;

		// Tooltip with detail
		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${summary.filePath}**\n\n`);
		tooltip.appendMarkdown(`- Score: **${summary.currentScore}/100**\n`);
		tooltip.appendMarkdown(`- Average: ${summary.averageScore}/100\n`);
		if (summary.previousScore !== undefined) {
			tooltip.appendMarkdown(`- Previous: ${summary.previousScore}/100\n`);
		}
		tooltip.appendMarkdown(`- Reviews: ${summary.reviewCount}\n`);
		tooltip.appendMarkdown(`- Last reviewed: ${new Date(summary.lastReviewedAt).toLocaleDateString()}\n`);
		const fc = summary.findingCounts;
		tooltip.appendMarkdown(`- Findings: ${fc.critical}C ${fc.high}H ${fc.medium}M ${fc.low}L\n`);

		if (summary.delta !== undefined && summary.delta < 0) {
			tooltip.appendMarkdown(`\n⚠️ **Regressed by ${Math.abs(summary.delta)} points**`);
		}
		item.tooltip = tooltip;

		// Click to open file
		item.command = {
			command: 'ollama-code-review.openHealthFile',
			title: 'Open File',
			arguments: [element],
		};

		item.contextValue = summary.delta !== undefined && summary.delta < -5
			? 'healthFileRegressed'
			: 'healthFile';

		return item;
	}

	getChildren(element?: TreeElement): TreeElement[] {
		if (!element) {
			// Ensure data is built
			if (this._tiers.length === 0) {
				this._buildTiers();
			}
			return this._tiers.map(t => new TierNode(t));
		}

		if (element instanceof TierNode) {
			return element.group.items.map(s => new FileHealthNode(s));
		}

		return [];
	}

	getParent(element: TreeElement): TreeElement | undefined {
		if (element instanceof FileHealthNode) {
			const tier = getTier(element.summary.currentScore);
			const group = this._tiers.find(t => t.id === tier);
			if (group) { return new TierNode(group); }
		}
		return undefined;
	}
}
