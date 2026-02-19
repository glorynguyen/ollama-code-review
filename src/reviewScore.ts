/**
 * F-016: Review Quality Scoring & Trends
 *
 * Computes a 0–100 quality score from each review's finding counts,
 * persists the score history in a local JSON file inside the extension's
 * global storage, and provides a webview panel to visualise the trend.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { FindingCounts } from './notifications';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReviewScore {
	id: string;
	timestamp: string;
	repo: string;
	branch: string;
	model: string;
	profile: string;
	score: number;
	correctness: number;
	security: number;
	maintainability: number;
	performance: number;
	findingCounts: FindingCounts;
	/** Display label — file path, folder, or branch */
	label?: string;
}

// ─── Score computation ───────────────────────────────────────────────────────

/**
 * Derive finding counts from an AI review's raw Markdown text.
 * This is a heuristic — it counts severity keywords and emoji badges.
 */
export function parseFindingCounts(reviewText: string): FindingCounts {
	const lines = reviewText.split('\n');
	const counts: FindingCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

	for (const line of lines) {
		const lower = line.toLowerCase();
		// Match patterns like "**severity:** critical", "🔴 Critical", "- critical:"
		if (/\b(critical)\b/.test(lower) && /severity|🔴|\*\*/.test(lower)) { counts.critical++; }
		else if (/\b(high)\b/.test(lower) && /severity|🟠|\*\*/.test(lower))   { counts.high++; }
		else if (/\b(medium|moderate)\b/.test(lower) && /severity|🟡|\*\*/.test(lower)) { counts.medium++; }
		else if (/\b(low|minor)\b/.test(lower) && /severity|🟢|\*\*/.test(lower))  { counts.low++; }
		else if (/\b(info|note|informational)\b/.test(lower) && /severity|ℹ️|\*\*/.test(lower)) { counts.info++; }
	}

	// Cap to avoid inflation from docs / context
	counts.critical = Math.min(counts.critical, 10);
	counts.high     = Math.min(counts.high, 10);
	counts.medium   = Math.min(counts.medium, 10);
	counts.low      = Math.min(counts.low, 15);
	counts.info     = Math.min(counts.info, 20);

	return counts;
}

/**
 * Compute a composite quality score (0–100) from finding counts.
 *
 * Deductions:  critical=-20  high=-10  medium=-5  low=-2
 * Sub-scores are approximated from the same deduction.
 */
export function computeScore(counts: FindingCounts): Pick<ReviewScore, 'score' | 'correctness' | 'security' | 'maintainability' | 'performance'> {
	const deduction =
		counts.critical * 20 +
		counts.high     * 10 +
		counts.medium   *  5 +
		counts.low      *  2;

	const score = Math.max(0, Math.min(100, 100 - deduction));

	// Heuristic sub-score split (weights: correctness 35%, security 30%, maintainability 20%, performance 15%)
	return {
		score,
		correctness:    Math.max(0, Math.min(100, 100 - Math.round(deduction * 0.35))),
		security:       Math.max(0, Math.min(100, 100 - Math.round(deduction * 0.30))),
		maintainability: Math.max(0, Math.min(100, 100 - Math.round(deduction * 0.20))),
		performance:    Math.max(0, Math.min(100, 100 - Math.round(deduction * 0.15))),
	};
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Lightweight JSON-file store for review score history.
 * Avoids native (SQLite) dependencies; survives extension restarts.
 */
export class ReviewScoreStore {
	private static _instance: ReviewScoreStore | undefined;
	private readonly _path: string;
	private _scores: ReviewScore[] = [];

	private constructor(globalStoragePath: string) {
		this._path = path.join(globalStoragePath, 'review-scores.json');
		this._load();
	}

	static getInstance(globalStoragePath: string): ReviewScoreStore {
		if (!ReviewScoreStore._instance) {
			ReviewScoreStore._instance = new ReviewScoreStore(globalStoragePath);
		}
		return ReviewScoreStore._instance;
	}

	private _load(): void {
		try {
			if (fs.existsSync(this._path)) {
				this._scores = JSON.parse(fs.readFileSync(this._path, 'utf-8')) as ReviewScore[];
			}
		} catch {
			this._scores = [];
		}
	}

	private _save(): void {
		try {
			fs.mkdirSync(path.dirname(this._path), { recursive: true });
			fs.writeFileSync(this._path, JSON.stringify(this._scores, null, 2), 'utf-8');
		} catch {
			// Non-fatal — scores are in-memory even if write fails
		}
	}

	addScore(score: ReviewScore): void {
		this._scores.unshift(score);
		if (this._scores.length > 200) { this._scores = this._scores.slice(0, 200); }
		this._save();
	}

	getScores(limit = 30): ReviewScore[] {
		return this._scores.slice(0, limit);
	}

	getLastScore(): ReviewScore | undefined {
		return this._scores[0];
	}

	clear(): void {
		this._scores = [];
		this._save();
	}
}

// ─── Status bar helper ───────────────────────────────────────────────────────

export function updateScoreStatusBar(item: vscode.StatusBarItem, score: number): void {
	const icon = score >= 80 ? '$(check)' : score >= 60 ? '$(warning)' : '$(error)';
	item.text = `${icon} ${score}/100`;
	item.tooltip = `Review Quality Score: ${score}/100 — Click to view history`;
}

// ─── History webview panel ───────────────────────────────────────────────────

export class ReviewHistoryPanel {
	static currentPanel: ReviewHistoryPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];

	static createOrShow(scores: ReviewScore[]): void {
		if (ReviewHistoryPanel.currentPanel) {
			ReviewHistoryPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
			ReviewHistoryPanel.currentPanel._update(scores);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			'ollamaReviewHistory',
			'Review Quality History',
			vscode.ViewColumn.One,
			{ enableScripts: true },
		);
		ReviewHistoryPanel.currentPanel = new ReviewHistoryPanel(panel, scores);
	}

	private constructor(panel: vscode.WebviewPanel, scores: ReviewScore[]) {
		this._panel = panel;
		this._update(scores);
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
	}

	private _update(scores: ReviewScore[]): void {
		this._panel.webview.html = this._buildHtml(scores);
	}

	dispose(): void {
		ReviewHistoryPanel.currentPanel = undefined;
		this._panel.dispose();
		for (const d of this._disposables) { d.dispose(); }
		this._disposables = [];
	}

	private _buildHtml(scores: ReviewScore[]): string {
		const chartPoints = JSON.stringify(
			scores.slice().reverse().map(s => ({
				label: new Date(s.timestamp).toLocaleDateString(),
				score: s.score,
				model: s.model,
				profile: s.profile || 'general',
			})),
		);

		const tableRows = scores.map(s => {
			const date = new Date(s.timestamp).toLocaleString();
			const scoreColor = s.score >= 80 ? '#4CAF50' : s.score >= 60 ? '#FF9800' : '#F44336';
			const c = s.findingCounts;
			const badges = [
				c.critical > 0 ? `<span class="badge critical">🔴 ${c.critical}</span>` : '',
				c.high     > 0 ? `<span class="badge high">🟠 ${c.high}</span>` : '',
				c.medium   > 0 ? `<span class="badge medium">🟡 ${c.medium}</span>` : '',
				c.low      > 0 ? `<span class="badge low">🟢 ${c.low}</span>` : '',
			].filter(Boolean).join(' ');
			const src = s.label || s.branch || '—';
			return `<tr>
				<td>${date}</td>
				<td style="color:${scoreColor};font-weight:bold;text-align:center">${s.score}</td>
				<td>${s.model}</td>
				<td>${s.profile || 'general'}</td>
				<td title="${src}">${src.length > 40 ? '…' + src.slice(-38) : src}</td>
				<td>${badges || '—'}</td>
			</tr>`;
		}).join('\n');

		const avg = scores.length
			? Math.round(scores.reduce((a, b) => a + b.score, 0) / scores.length)
			: 0;
		const best = scores.length ? Math.max(...scores.map(s => s.score)) : 0;
		const last = scores.length ? scores[0].score : 0;
		const lastColor = last >= 80 ? '#4CAF50' : last >= 60 ? '#FF9800' : '#F44336';
		const avgColor  = avg  >= 80 ? '#4CAF50' : avg  >= 60 ? '#FF9800' : '#F44336';
		const bestColor = best >= 80 ? '#4CAF50' : best >= 60 ? '#FF9800' : '#F44336';

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Quality History</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 20px; margin: 0; }
    h1 { font-size: 1.2em; margin-bottom: 20px; opacity: 0.9; }
    .summary { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .card { background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 8px; padding: 12px 20px; text-align: center; min-width: 100px; }
    .card .value { font-size: 2em; font-weight: bold; line-height: 1.1; }
    .card .lbl { font-size: 0.75em; opacity: 0.65; margin-top: 4px; }
    .chart-wrap { max-height: 220px; margin-bottom: 28px; position: relative; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88em; }
    thead th { text-align: left; padding: 8px 10px; border-bottom: 2px solid var(--vscode-panel-border); opacity: 0.75; }
    tbody td { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
    tr:hover { background: var(--vscode-list-hoverBackground); }
    .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.8em; margin-right: 2px; background: var(--vscode-badge-background); }
    .empty { opacity: 0.5; margin-top: 40px; text-align: center; font-size: 1.1em; }
  </style>
</head>
<body>
  <h1>Review Quality History</h1>
  ${scores.length === 0 ? '<p class="empty">No review history yet. Run a code review to start tracking scores.</p>' : `
  <div class="summary">
    <div class="card"><div class="value" style="color:${lastColor}">${last}</div><div class="lbl">Latest Score</div></div>
    <div class="card"><div class="value" style="color:${avgColor}">${avg}</div><div class="lbl">Average (${scores.length})</div></div>
    <div class="card"><div class="value" style="color:${bestColor}">${best}</div><div class="lbl">Best Score</div></div>
  </div>
  <div class="chart-wrap"><canvas id="chart"></canvas></div>
  <table>
    <thead><tr><th>Date</th><th style="text-align:center">Score</th><th>Model</th><th>Profile</th><th>Source</th><th>Findings</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  `}
  <script>
    const pts = ${chartPoints};
    if (pts.length > 0) {
      const ctx = document.getElementById('chart').getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: pts.map(p => p.label),
          datasets: [{
            label: 'Quality Score',
            data: pts.map(p => p.score),
            borderColor: '#569cd6',
            backgroundColor: 'rgba(86,156,214,0.12)',
            tension: 0.3,
            fill: true,
            pointRadius: pts.length < 30 ? 4 : 2,
            pointHoverRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false }, tooltip: {
            callbacks: {
              afterLabel: ctx => {
                const p = pts[ctx.dataIndex];
                return p ? [\`Model: \${p.model}\`, \`Profile: \${p.profile}\`] : [];
              }
            }
          }},
          scales: {
            y: { min: 0, max: 100, grid: { color: 'rgba(200,200,200,0.08)' }, ticks: { color: 'rgba(200,200,200,0.6)' } },
            x: { grid: { display: false }, ticks: { color: 'rgba(200,200,200,0.6)', maxTicksLimit: 12 } },
          },
        },
      });
    }
  </script>
</body>
</html>`;
	}
}
