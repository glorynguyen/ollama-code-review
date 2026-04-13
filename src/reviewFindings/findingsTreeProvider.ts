/**
 * F-031: Review Findings Explorer — TreeDataProvider
 * F-034: Severity Filter & Export — filter tree by severity, export as Markdown
 *
 * Displays review findings in a navigable tree view in the sidebar,
 * organized by file and severity. Clicking a finding navigates to
 * the relevant file and line in the editor.
 */

import * as vscode from 'vscode';
import type { ReviewFinding, Severity } from '../github/commentMapper';
import { parseReviewIntoFindings } from '../github/commentMapper';
import type { IndexedFinding } from './types';

// ── Severity metadata ────────────────────────────────────────────────

const SEVERITY_ICONS: Record<Severity, vscode.ThemeIcon> = {
	critical: new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground')),
	high: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
	medium: new vscode.ThemeIcon('info', new vscode.ThemeColor('notificationsInfoIcon.foreground')),
	low: new vscode.ThemeIcon('lightbulb', new vscode.ThemeColor('charts.green')),
	info: new vscode.ThemeIcon('comment', new vscode.ThemeColor('descriptionForeground')),
};

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_EMOJI: Record<Severity, string> = {
	critical: '🔴',
	high: '🟠',
	medium: '🔵',
	low: '🟢',
	info: '⚪',
};

// ── Tree Item Types ──────────────────────────────────────────────────

type TreeElement = FileNode | FindingNode;

class FileNode {
	constructor(
		public readonly filePath: string,
		public readonly findings: IndexedFinding[],
	) {}

	get severityCounts(): Record<Severity, number> {
		const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
		for (const f of this.findings) { counts[f.severity]++; }
		return counts;
	}
}

class FindingNode {
	constructor(
		public readonly finding: IndexedFinding,
		public readonly parentFile: string,
	) {}
}

// ── TreeDataProvider ─────────────────────────────────────────────────

export class FindingsTreeProvider implements vscode.TreeDataProvider<TreeElement> {
	private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private findings: IndexedFinding[] = [];
	private fileNodes: FileNode[] = [];

	// ── F-034: Severity filter state ──────────────────────────────────
	private _activeSeverities: Set<Severity> = new Set(SEVERITY_ORDER);
	private _isFiltered = false;

	/**
	 * Update the tree with findings from a completed review.
	 */
	setFindings(reviewText: string, diff: string): void {
		const raw = parseReviewIntoFindings(reviewText, diff);
		this.findings = raw.map((f, i) => ({ ...f, index: i }));
		this.buildTree();
		this._onDidChangeTreeData.fire();
	}

	/** Clear all findings from the tree. */
	clear(): void {
		this.findings = [];
		this.fileNodes = [];
		this._onDidChangeTreeData.fire();
	}

	/** Remove a specific finding and refresh the tree. */
	removeFinding(finding: ReviewFinding): void {
		const index = this.findings.findIndex(f =>
			f.file === finding.file &&
			f.line === finding.line &&
			f.severity === finding.severity &&
			f.message === finding.message
		);

		if (index !== -1) {
			this.findings.splice(index, 1);
			this.buildTree();
			this._onDidChangeTreeData.fire();
		}
	}

	/** Get all current findings (for external consumers). */
	getFindings(): readonly ReviewFinding[] {
		return this.findings;
	}

	/** Get total finding count. */
	get count(): number {
		return this.findings.length;
	}

	/** F-034: Get the count of currently visible (filtered) findings. */
	get filteredCount(): number {
		if (!this._isFiltered) { return this.findings.length; }
		return this.findings.filter(f => this._activeSeverities.has(f.severity)).length;
	}

	/** F-034: Whether a severity filter is active. */
	get isFiltered(): boolean {
		return this._isFiltered;
	}

	/** F-034: Get the set of active severity levels. */
	get activeSeverities(): ReadonlySet<Severity> {
		return this._activeSeverities;
	}

	// ── F-034: Filter methods ─────────────────────────────────────────

	/**
	 * Show a QuickPick to let the user select which severity levels to show.
	 */
	async showFilterPicker(): Promise<void> {
		type SeverityPickItem = vscode.QuickPickItem & { severity: Severity };
		const items: SeverityPickItem[] = SEVERITY_ORDER.map(sev => ({
			label: `${SEVERITY_EMOJI[sev]} ${sev.charAt(0).toUpperCase() + sev.slice(1)}`,
			severity: sev,
			picked: this._activeSeverities.has(sev),
			description: `${this.findings.filter(f => f.severity === sev).length} finding(s)`,
		}));

		const picked = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: 'Select severity levels to show (uncheck to hide)',
			title: 'Filter Findings by Severity',
		});

		if (!picked) { return; } // cancelled

		this._activeSeverities = new Set(picked.map((p: SeverityPickItem) => p.severity));
		this._isFiltered = this._activeSeverities.size < SEVERITY_ORDER.length;
		this.buildTree();
		this._onDidChangeTreeData.fire();
	}

	/** F-034: Reset filter to show all severity levels. */
	showAll(): void {
		this._activeSeverities = new Set(SEVERITY_ORDER);
		this._isFiltered = false;
		this.buildTree();
		this._onDidChangeTreeData.fire();
	}

	/**
	 * F-034: Export all findings (respecting current filter) as a Markdown checklist.
	 * Returns the Markdown string.
	 */
	exportAsMarkdown(): string {
		const visibleFindings = this._isFiltered
			? this.findings.filter(f => this._activeSeverities.has(f.severity))
			: this.findings;

		if (visibleFindings.length === 0) {
			return '# Review Findings\n\nNo findings to export.\n';
		}

		// Group by file
		const fileMap = new Map<string, IndexedFinding[]>();
		for (const f of visibleFindings) {
			const key = f.file ?? '(no file reference)';
			if (!fileMap.has(key)) { fileMap.set(key, []); }
			fileMap.get(key)!.push(f);
		}

		const lines: string[] = ['# Review Findings', ''];

		// Summary counts
		const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
		for (const f of visibleFindings) { counts[f.severity]++; }
		const summaryParts = SEVERITY_ORDER
			.filter(s => counts[s] > 0)
			.map(s => `${SEVERITY_EMOJI[s]} ${counts[s]} ${s}`);
		lines.push(`**${visibleFindings.length} findings:** ${summaryParts.join(' | ')}`, '');

		for (const [filePath, findings] of fileMap) {
			lines.push(`## ${filePath}`, '');
			for (const f of findings) {
				const loc = f.line ? `:${f.line}` : '';
				const msg = f.message.replace(/\n/g, ' ').trim();
				lines.push(`- [ ] ${SEVERITY_EMOJI[f.severity]} **${f.severity}**${loc ? ` (L${f.line})` : ''}: ${msg}`);
				if (f.suggestion) {
					lines.push(`  - **Suggestion:** ${f.suggestion.replace(/\n/g, ' ').trim()}`);
				}
			}
			lines.push('');
		}

		return lines.join('\n');
	}

	// ── TreeDataProvider implementation ───────────────────────────────

	getTreeItem(element: TreeElement): vscode.TreeItem {
		if (element instanceof FileNode) {
			return this.buildFileTreeItem(element);
		}
		return this.buildFindingTreeItem(element);
	}

	getChildren(element?: TreeElement): TreeElement[] {
		if (!element) {
			// Root level: file nodes (or ungrouped findings without file refs)
			return this.fileNodes;
		}
		if (element instanceof FileNode) {
			// Sort findings within a file by severity then line number
			return element.findings
				.map(f => new FindingNode(f, element.filePath))
				.sort((a, b) => {
					const sevDiff = SEVERITY_ORDER.indexOf(a.finding.severity) - SEVERITY_ORDER.indexOf(b.finding.severity);
					if (sevDiff !== 0) { return sevDiff; }
					return (a.finding.line ?? 0) - (b.finding.line ?? 0);
				});
		}
		return [];
	}

	getParent(element: TreeElement): TreeElement | undefined {
		if (element instanceof FindingNode) {
			return this.fileNodes.find(n => n.filePath === element.parentFile);
		}
		return undefined;
	}

	// ── Tree building ─────────────────────────────────────────────────

	private buildTree(): void {
		// F-034: Apply severity filter
		const visibleFindings = this._isFiltered
			? this.findings.filter(f => this._activeSeverities.has(f.severity))
			: this.findings;

		const fileMap = new Map<string, IndexedFinding[]>();

		for (const finding of visibleFindings) {
			const key = finding.file ?? '(no file reference)';
			if (!fileMap.has(key)) { fileMap.set(key, []); }
			fileMap.get(key)!.push(finding);
		}

		// Sort file nodes: files with higher-severity findings first
		this.fileNodes = Array.from(fileMap.entries())
			.map(([filePath, findings]) => new FileNode(filePath, findings))
			.sort((a, b) => {
				const aMax = Math.min(...a.findings.map(f => SEVERITY_ORDER.indexOf(f.severity)));
				const bMax = Math.min(...b.findings.map(f => SEVERITY_ORDER.indexOf(f.severity)));
				if (aMax !== bMax) { return aMax - bMax; }
				return a.filePath.localeCompare(b.filePath);
			});
	}

	// ── Tree item builders ────────────────────────────────────────────

	private buildFileTreeItem(node: FileNode): vscode.TreeItem {
		const counts = node.severityCounts;
		const parts: string[] = [];
		for (const sev of SEVERITY_ORDER) {
			if (counts[sev] > 0) {
				parts.push(`${counts[sev]} ${sev}`);
			}
		}

		const item = new vscode.TreeItem(
			node.filePath,
			vscode.TreeItemCollapsibleState.Expanded,
		);
		item.description = parts.join(', ');
		item.contextValue = 'findingsFile';
		item.resourceUri = node.filePath !== '(no file reference)'
			? vscode.Uri.file(node.filePath)
			: undefined;

		// Use the highest severity icon for the file node
		const highestSeverity = SEVERITY_ORDER.find(s => counts[s] > 0) ?? 'info';
		item.iconPath = SEVERITY_ICONS[highestSeverity];

		return item;
	}

	private buildFindingTreeItem(node: FindingNode): vscode.TreeItem {
		const { finding } = node;
		const linePrefix = finding.line ? `L${finding.line}: ` : '';

		// Truncate message for display
		const maxLen = 100;
		const msg = finding.message.replace(/\n/g, ' ').trim();
		const displayMsg = msg.length > maxLen ? msg.slice(0, maxLen - 3) + '...' : msg;

		const item = new vscode.TreeItem(
			`${linePrefix}${displayMsg}`,
			vscode.TreeItemCollapsibleState.None,
		);

		item.iconPath = SEVERITY_ICONS[finding.severity];
		// F-033: contextValue includes 'finding' for inline fix action; add 'fixable' when file+line exist
		item.contextValue = (finding.file && finding.file !== '(no file reference)') ? 'finding' : 'findingNoFile';
		item.tooltip = new vscode.MarkdownString();
		(item.tooltip as vscode.MarkdownString).isTrusted = true;
		(item.tooltip as vscode.MarkdownString).appendMarkdown(
			`**${finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1)}**\n\n${finding.message}`
		);
		if (finding.suggestion) {
			(item.tooltip as vscode.MarkdownString).appendMarkdown('\n\n**Suggestion:**\n');
			(item.tooltip as vscode.MarkdownString).appendCodeblock(finding.suggestion, 'typescript');
		}
		// F-033: Add "Quick Fix" command link in tooltip
		if (finding.file && finding.file !== '(no file reference)') {
			const fixArgs = encodeURIComponent(JSON.stringify([finding]));
			(item.tooltip as vscode.MarkdownString).appendMarkdown(
				`\n\n[$(wrench) Quick Fix](command:ollama-code-review.fixFinding?${fixArgs} "Ask AI to fix this issue")`
			);
		}

		// Navigate to file:line on click
		if (finding.file && finding.file !== '(no file reference)') {
			item.command = {
				command: 'ollama-code-review.goToFinding',
				title: 'Go to Finding',
				arguments: [finding.file, finding.line],
			};
		}

		return item;
	}

	/** F-033: Get the finding associated with a FindingNode tree element. */
	getFindingFromElement(element: unknown): IndexedFinding | undefined {
		if (element instanceof FindingNode) {
			return element.finding;
		}
		return undefined;
	}

	/** F-044: Get the file path from a FileNode element. */
	getFilePathFromElement(element: unknown): string | undefined {
		if (element instanceof FileNode && element.filePath !== '(no file reference)') {
			return element.filePath;
		}
		return undefined;
	}

	/** F-044: Get the first finding for a FileNode (for scroll target). */
	getFirstFindingForFile(element: unknown): IndexedFinding | undefined {
		if (element instanceof FileNode && element.findings.length > 0) {
			return element.findings[0];
		}
		return undefined;
	}
}
