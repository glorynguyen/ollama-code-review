/**
 * F-011: Review Analytics Dashboard
 *
 * A rich webview panel that displays comprehensive analytics from review history.
 * Features: summary cards, score trends, severity/category breakdowns, model/profile
 * usage, most-reviewed files, and data export (CSV/JSON).
 */

import * as vscode from 'vscode';
import type { ReviewScore } from '../reviewScore';
import { computeAnalytics, exportAsCSV, exportAsJSON, type AnalyticsSummary } from './tracker';

export class AnalyticsDashboardPanel {
	static currentPanel: AnalyticsDashboardPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];
	private _scores: ReviewScore[];

	static createOrShow(scores: ReviewScore[]): void {
		if (AnalyticsDashboardPanel.currentPanel) {
			AnalyticsDashboardPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
			AnalyticsDashboardPanel.currentPanel._update(scores);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'ollamaAnalyticsDashboard',
			'Review Analytics Dashboard',
			vscode.ViewColumn.One,
			{ enableScripts: true },
		);
		AnalyticsDashboardPanel.currentPanel = new AnalyticsDashboardPanel(panel, scores);
	}

	private constructor(panel: vscode.WebviewPanel, scores: ReviewScore[]) {
		this._panel = panel;
		this._scores = scores;
		this._update(scores);
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
		this._panel.webview.onDidReceiveMessage(
			msg => this._handleMessage(msg),
			null,
			this._disposables,
		);
	}

	private _update(scores: ReviewScore[]): void {
		this._scores = scores;
		this._panel.webview.html = this._buildHtml(scores);
	}

	dispose(): void {
		AnalyticsDashboardPanel.currentPanel = undefined;
		this._panel.dispose();
		for (const d of this._disposables) { d.dispose(); }
		this._disposables = [];
	}

	private async _handleMessage(msg: { command: string }): Promise<void> {
		if (msg.command === 'exportCSV') {
			const uri = await vscode.window.showSaveDialog({
				filters: { 'CSV Files': ['csv'] },
				defaultUri: vscode.Uri.file('review-analytics.csv'),
			});
			if (uri) {
				await vscode.workspace.fs.writeFile(uri, Buffer.from(exportAsCSV(this._scores), 'utf-8'));
				vscode.window.showInformationMessage(`Analytics exported to ${uri.fsPath}`);
			}
		} else if (msg.command === 'exportJSON') {
			const uri = await vscode.window.showSaveDialog({
				filters: { 'JSON Files': ['json'] },
				defaultUri: vscode.Uri.file('review-analytics.json'),
			});
			if (uri) {
				await vscode.workspace.fs.writeFile(uri, Buffer.from(exportAsJSON(this._scores), 'utf-8'));
				vscode.window.showInformationMessage(`Analytics exported to ${uri.fsPath}`);
			}
		}
	}

	private _buildHtml(scores: ReviewScore[]): string {
		const analytics = computeAnalytics(scores);

		if (scores.length === 0) {
			return this._emptyHtml();
		}

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Analytics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 20px;
    }
    h1 { font-size: 1.3em; margin-bottom: 6px; }
    .subtitle { font-size: 0.85em; opacity: 0.6; margin-bottom: 20px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 20px; }
    .toolbar button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 4px;
      padding: 6px 14px; cursor: pointer; font-size: 0.82em;
    }
    .toolbar button:hover { background: var(--vscode-button-hoverBackground); }

    /* Summary cards */
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px; padding: 14px 16px; text-align: center;
    }
    .card .value { font-size: 1.8em; font-weight: bold; line-height: 1.1; }
    .card .lbl { font-size: 0.72em; opacity: 0.6; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Grid layout for charts */
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .grid-full { grid-column: 1 / -1; }
    .panel {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px; padding: 16px;
    }
    .panel h2 { font-size: 0.95em; margin-bottom: 12px; opacity: 0.85; }
    .chart-container { position: relative; height: 200px; }
    .chart-container-wide { position: relative; height: 180px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 0.82em; }
    thead th { text-align: left; padding: 6px 10px; border-bottom: 2px solid var(--vscode-panel-border); opacity: 0.7; }
    tbody td { padding: 5px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    tr:hover { background: var(--vscode-list-hoverBackground); }
    .badge { display: inline-block; padding: 1px 8px; border-radius: 3px; font-size: 0.8em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }

    @media (max-width: 700px) {
      .grid { grid-template-columns: 1fr; }
      .cards { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <h1>Review Analytics Dashboard</h1>
  <p class="subtitle">${scores.length} reviews tracked${analytics.averageDurationMs ? ` · avg ${formatDuration(analytics.averageDurationMs)}` : ''}</p>

  <div class="toolbar">
    <button onclick="exportCSV()">Export CSV</button>
    <button onclick="exportJSON()">Export JSON</button>
  </div>

  ${this._renderCards(analytics)}

  <div class="grid">
    <!-- Score trend (full width) -->
    <div class="panel grid-full">
      <h2>Score Trend</h2>
      <div class="chart-container-wide"><canvas id="scoreTrendChart"></canvas></div>
    </div>

    <!-- Severity distribution -->
    <div class="panel">
      <h2>Issues by Severity</h2>
      <div class="chart-container"><canvas id="severityChart"></canvas></div>
    </div>

    <!-- Category distribution -->
    <div class="panel">
      <h2>Issues by Category</h2>
      <div class="chart-container"><canvas id="categoryChart"></canvas></div>
    </div>

    <!-- Review type breakdown -->
    <div class="panel">
      <h2>Review Types</h2>
      <div class="chart-container"><canvas id="typeChart"></canvas></div>
    </div>

    <!-- Model usage -->
    <div class="panel">
      <h2>Model Usage</h2>
      <div class="chart-container"><canvas id="modelChart"></canvas></div>
    </div>

    ${this._renderTopFiles(analytics)}
    ${this._renderProfileTable(analytics)}
    ${this._renderWeeklyActivity(analytics)}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function exportCSV() { vscode.postMessage({ command: 'exportCSV' }); }
    function exportJSON() { vscode.postMessage({ command: 'exportJSON' }); }

    // ─── Chart defaults ──────────────────────────────────────────
    Chart.defaults.color = 'rgba(200,200,200,0.7)';
    Chart.defaults.borderColor = 'rgba(200,200,200,0.08)';

    // ─── Score Trend ─────────────────────────────────────────────
    ${this._scoreTrendScript(scores)}

    // ─── Severity Doughnut ───────────────────────────────────────
    ${this._severityChartScript(analytics)}

    // ─── Category Bar ────────────────────────────────────────────
    ${this._categoryChartScript(analytics)}

    // ─── Review Type Doughnut ────────────────────────────────────
    ${this._typeChartScript(analytics)}

    // ─── Model Usage Bar ─────────────────────────────────────────
    ${this._modelChartScript(analytics)}
  </script>
</body>
</html>`;
	}

	private _emptyHtml(): string {
		return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><style>
  body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 40px; text-align: center; }
  h1 { font-size: 1.2em; opacity: 0.9; }
  p { opacity: 0.5; margin-top: 12px; font-size: 1em; }
</style></head><body>
  <h1>Review Analytics Dashboard</h1>
  <p>No review history yet. Run a code review to start tracking analytics.</p>
</body></html>`;
	}

	private _renderCards(a: AnalyticsSummary): string {
		const scoreColor = (s: number) => s >= 80 ? '#4CAF50' : s >= 60 ? '#FF9800' : '#F44336';
		return `<div class="cards">
      <div class="card"><div class="value">${a.totalReviews}</div><div class="lbl">Total Reviews</div></div>
      <div class="card"><div class="value" style="color:${scoreColor(a.averageScore)}">${a.averageScore}</div><div class="lbl">Avg Score</div></div>
      <div class="card"><div class="value" style="color:${scoreColor(a.bestScore)}">${a.bestScore}</div><div class="lbl">Best Score</div></div>
      <div class="card"><div class="value">${a.totalIssues}</div><div class="lbl">Total Issues</div></div>
      <div class="card"><div class="value">${a.reviewsThisWeek}</div><div class="lbl">This Week</div></div>
      <div class="card"><div class="value">${a.reviewsThisMonth}</div><div class="lbl">This Month</div></div>
    </div>`;
	}

	private _renderTopFiles(a: AnalyticsSummary): string {
		if (a.topFiles.length === 0) { return ''; }
		const rows = a.topFiles.map(f =>
			`<tr><td title="${f.file}">${f.file.length > 55 ? '...' + f.file.slice(-52) : f.file}</td><td style="text-align:center">${f.count}</td></tr>`
		).join('');
		return `<div class="panel">
      <h2>Most Reviewed Files</h2>
      <table><thead><tr><th>File</th><th style="text-align:center">Reviews</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
	}

	private _renderProfileTable(a: AnalyticsSummary): string {
		const entries = Object.entries(a.profileUsage).sort((x, y) => y[1] - x[1]);
		if (entries.length === 0) { return ''; }
		const rows = entries.map(([profile, count]) =>
			`<tr><td>${profile}</td><td style="text-align:center">${count}</td><td style="text-align:center">${Math.round(count / a.totalReviews * 100)}%</td></tr>`
		).join('');
		return `<div class="panel">
      <h2>Profile Usage</h2>
      <table><thead><tr><th>Profile</th><th style="text-align:center">Count</th><th style="text-align:center">%</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
	}

	private _renderWeeklyActivity(a: AnalyticsSummary): string {
		const weeks = a.weeklyScores.filter(w => w.count > 0);
		if (weeks.length === 0) { return ''; }
		const rows = weeks.map(w =>
			`<tr><td>Week of ${w.weekLabel}</td><td style="text-align:center">${w.count}</td><td style="text-align:center">${w.avgScore || '—'}</td></tr>`
		).join('');
		return `<div class="panel">
      <h2>Weekly Activity</h2>
      <table><thead><tr><th>Week</th><th style="text-align:center">Reviews</th><th style="text-align:center">Avg Score</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
	}

	// ─── Chart scripts ──────────────────────────────────────────────

	private _scoreTrendScript(scores: ReviewScore[]): string {
		const pts = scores.slice().reverse().map(s => ({
			label: new Date(s.timestamp).toLocaleDateString(),
			score: s.score,
		}));
		return `
    new Chart(document.getElementById('scoreTrendChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(pts.map(p => p.label))},
        datasets: [{
          label: 'Score',
          data: ${JSON.stringify(pts.map(p => p.score))},
          borderColor: '#569cd6',
          backgroundColor: 'rgba(86,156,214,0.1)',
          tension: 0.3, fill: true,
          pointRadius: ${pts.length < 40 ? 3 : 1},
          pointHoverRadius: 5,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { stepSize: 20 } },
          x: { ticks: { maxTicksLimit: 14 } },
        },
      },
    });`;
	}

	private _severityChartScript(a: AnalyticsSummary): string {
		const d = a.severityDistribution;
		const data = [d.critical, d.high, d.medium, d.low, d.info];
		if (data.every(v => v === 0)) {
			return '// No severity data';
		}
		return `
    new Chart(document.getElementById('severityChart').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low', 'Info'],
        datasets: [{
          data: ${JSON.stringify(data)},
          backgroundColor: ['#F44336','#FF9800','#FFC107','#4CAF50','#2196F3'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } },
      },
    });`;
	}

	private _categoryChartScript(a: AnalyticsSummary): string {
		const entries = Object.entries(a.categoryDistribution)
			.filter(([, v]) => v && v > 0)
			.sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0));
		if (entries.length === 0) {
			return '// No category data';
		}
		const labels = entries.map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
		const values = entries.map(([, v]) => v);
		const colors = ['#E91E63','#9C27B0','#3F51B5','#009688','#FF5722','#607D8B','#795548','#CDDC39'];
		return `
    new Chart(document.getElementById('categoryChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          data: ${JSON.stringify(values)},
          backgroundColor: ${JSON.stringify(colors.slice(0, entries.length))},
          borderWidth: 0, borderRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });`;
	}

	private _typeChartScript(a: AnalyticsSummary): string {
		const entries = Object.entries(a.reviewTypeBreakdown)
			.filter(([, v]) => v > 0)
			.sort((x, y) => y[1] - x[1]);
		if (entries.length === 0) {
			return '// No type data';
		}
		const labels = entries.map(([k]) => k);
		const values = entries.map(([, v]) => v);
		const colors = ['#42A5F5','#66BB6A','#FFA726','#AB47BC','#EC407A','#26C6DA','#8D6E63','#78909C'];
		return `
    new Chart(document.getElementById('typeChart').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          data: ${JSON.stringify(values)},
          backgroundColor: ${JSON.stringify(colors.slice(0, entries.length))},
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } },
      },
    });`;
	}

	private _modelChartScript(a: AnalyticsSummary): string {
		const entries = Object.entries(a.modelUsage)
			.sort((x, y) => y[1] - x[1])
			.slice(0, 8);
		if (entries.length === 0) {
			return '// No model data';
		}
		const labels = entries.map(([k]) => k.length > 25 ? k.slice(0, 22) + '...' : k);
		const values = entries.map(([, v]) => v);
		return `
    new Chart(document.getElementById('modelChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          data: ${JSON.stringify(values)},
          backgroundColor: '#569cd6',
          borderWidth: 0, borderRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });`;
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
	if (ms < 1000) { return `${ms}ms`; }
	if (ms < 60_000) { return `${(ms / 1000).toFixed(1)}s`; }
	return `${(ms / 60_000).toFixed(1)}min`;
}
