import * as vscode from 'vscode';
import { escapeHtml } from '../utils';
import type { ComparisonResult, ModelComparisonEntry } from './types';

export class ComparisonPanel {
	public static currentPanel: ComparisonPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];

	private constructor(panel: vscode.WebviewPanel, result: ComparisonResult) {
		this._panel = panel;
		this._panel.webview.html = this._getHtml(result);
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.webview.onDidReceiveMessage(
			async (message) => {
				if (message.command === 'copyReview') {
					await vscode.env.clipboard.writeText(message.text);
					vscode.window.showInformationMessage('Review copied to clipboard.');
				}
			},
			null,
			this._disposables,
		);
	}

	public static createOrShow(result: ComparisonResult) {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (ComparisonPanel.currentPanel) {
			ComparisonPanel.currentPanel._panel.reveal(column);
			ComparisonPanel.currentPanel._panel.webview.html =
				ComparisonPanel.currentPanel._getHtml(result);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'ollamaModelComparison',
			'Model Comparison',
			column || vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true },
		);

		ComparisonPanel.currentPanel = new ComparisonPanel(panel, result);
	}

	public dispose() {
		ComparisonPanel.currentPanel = undefined;
		this._panel.dispose();
		while (this._disposables.length) {
			const d = this._disposables.pop();
			if (d) { d.dispose(); }
		}
	}

	private _getHtml(result: ComparisonResult): string {
		const cols = result.entries.map((e, i) => this._renderColumn(e, i)).join('\n');
		const bestScore = Math.max(...result.entries.filter(e => !e.error).map(e => e.score));
		const fastestMs = Math.min(...result.entries.filter(e => !e.error).map(e => e.durationMs));
		const summaryRows = result.entries
			.map((e) => {
				const isBestScore = !e.error && e.score === bestScore;
				const isFastest = !e.error && e.durationMs === fastestMs;
				const scoreBadge = isBestScore ? ' <span class="badge best">Best</span>' : '';
				const speedBadge = isFastest ? ' <span class="badge fastest">Fastest</span>' : '';
				const dur = e.error ? 'Error' : formatDuration(e.durationMs);
				const score = e.error ? '—' : `${e.score}/100`;
				return `<tr>
					<td><strong>${escapeHtml(e.model)}</strong></td>
					<td>${score}${scoreBadge}</td>
					<td>${dur}${speedBadge}</td>
					<td class="severity">${e.error ? '—' : `<span class="crit">${e.findingCounts.critical}C</span> <span class="high">${e.findingCounts.high}H</span> <span class="med">${e.findingCounts.medium}M</span> <span class="low">${e.findingCounts.low}L</span>`}</td>
				</tr>`;
			})
			.join('\n');

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Model Comparison</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js"></script>
<style>
:root{--bg:#1e1e1e;--card:#252526;--border:#3c3c3c;--text:#cccccc;--accent:#569cd6;--green:#4ec9b0;--orange:#ce9178;--red:#f44747;--yellow:#dcdcaa}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px;font-size:13px}
h1{font-size:1.4em;margin-bottom:4px;color:var(--accent)}
.subtitle{color:#888;font-size:.85em;margin-bottom:16px}
.summary-table{width:100%;border-collapse:collapse;margin-bottom:20px}
.summary-table th,.summary-table td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--border)}
.summary-table th{color:var(--accent);font-weight:600;font-size:.85em;text-transform:uppercase}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:.75em;font-weight:600;margin-left:6px}
.badge.best{background:#2d5f2d;color:#4ec9b0}
.badge.fastest{background:#5f4b2d;color:#dcdcaa}
.severity .crit{color:var(--red)}.severity .high{color:var(--orange)}.severity .med{color:var(--accent)}.severity .low{color:var(--green)}
.columns{display:flex;gap:12px;overflow-x:auto}
.col{flex:1;min-width:360px;background:var(--card);border:1px solid var(--border);border-radius:6px;display:flex;flex-direction:column}
.col-header{padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.col-header h2{font-size:1em;color:var(--accent);margin:0}
.col-body{padding:14px;overflow-y:auto;flex:1;max-height:70vh}
.col-body pre{white-space:pre-wrap;word-wrap:break-word}
.col-body pre code{font-size:12px}
.col-body p,.col-body ul,.col-body ol,.col-body li{margin-bottom:6px}
.col-body h1,.col-body h2,.col-body h3,.col-body h4{color:var(--accent);margin:12px 0 6px}
.col-body code{background:#333;padding:1px 4px;border-radius:3px;font-size:12px}
.col-body blockquote{border-left:3px solid var(--accent);padding-left:10px;color:#999;margin:8px 0}
.copy-btn{background:transparent;border:1px solid var(--border);color:var(--text);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.8em}
.copy-btn:hover{background:var(--border)}
.error-msg{color:var(--red);font-style:italic}
.score-pill{font-size:.8em;padding:2px 8px;border-radius:10px;font-weight:600}
.score-good{background:#2d5f2d;color:#4ec9b0}
.score-ok{background:#5f4b2d;color:#dcdcaa}
.score-bad{background:#5f2d2d;color:#f44747}
</style>
</head>
<body>
<h1>Multi-Model Review Comparison</h1>
<p class="subtitle">${escapeHtml(result.timestamp)} &mdash; ${result.entries.length} model(s) compared</p>

<table class="summary-table">
<thead><tr><th>Model</th><th>Score</th><th>Duration</th><th>Findings</th></tr></thead>
<tbody>${summaryRows}</tbody>
</table>

<div class="columns">${cols}</div>

<script>
const vscode = acquireVsCodeApi();
document.querySelectorAll('.review-content').forEach(el => {
	el.innerHTML = marked.parse(el.textContent || '');
	el.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
});
function copyReview(idx) {
	const el = document.querySelectorAll('.review-raw')[idx];
	vscode.postMessage({ command: 'copyReview', text: el.textContent });
}
</script>
</body>
</html>`;
	}

	private _renderColumn(entry: ModelComparisonEntry, idx: number): string {
		const scoreClass = entry.score >= 80 ? 'score-good' : entry.score >= 60 ? 'score-ok' : 'score-bad';

		if (entry.error) {
			return `<div class="col">
				<div class="col-header"><h2>${escapeHtml(entry.model)}</h2></div>
				<div class="col-body"><p class="error-msg">Error: ${escapeHtml(entry.error)}</p></div>
			</div>`;
		}

		return `<div class="col">
			<div class="col-header">
				<h2>${escapeHtml(entry.model)} <span class="score-pill ${scoreClass}">${entry.score}/100</span></h2>
				<button class="copy-btn" onclick="copyReview(${idx})">Copy</button>
			</div>
			<div class="col-body">
				<div class="review-content">${escapeHtml(entry.review)}</div>
				<div class="review-raw" style="display:none">${escapeHtml(entry.review)}</div>
			</div>
		</div>`;
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) { return `${ms}ms`; }
	if (ms < 60_000) { return `${(ms / 1000).toFixed(1)}s`; }
	return `${(ms / 60_000).toFixed(1)}min`;
}
