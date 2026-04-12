import type { ClaudeUsageData, UsageSnapshot, BudgetMetrics } from './claudeUsageTypes';

const WIDGET_ID = 'ocr-claude-usage-tracker';
const STORAGE_KEY = 'claudeUsageHistory';
const MAX_SNAPSHOTS = 90;
const SCRAPE_TIMEOUT_MS = 10_000;

init();

function init(): void {
	const data = scrapeUsageData();
	if (data) {
		onDataReady(data);
		return;
	}

	// SPA may load content asynchronously — watch for DOM changes
	let resolved = false;
	const timeout = setTimeout(() => {
		resolved = true;
		observer.disconnect();
		console.warn('[OCR Usage Tracker] Could not scrape usage data within timeout.');
	}, SCRAPE_TIMEOUT_MS);

	const observer = new MutationObserver(() => {
		if (resolved) { return; }
		const result = scrapeUsageData();
		if (result) {
			resolved = true;
			clearTimeout(timeout);
			observer.disconnect();
			onDataReady(result);
		}
	});

	observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function onDataReady(data: ClaudeUsageData): void {
	const metrics = calculateBudgetMetrics(data);
	injectWidget(data, metrics);
	void saveSnapshot(data);
}

// ---------------------------------------------------------------------------
// Scraping
// ---------------------------------------------------------------------------

function scrapeUsageData(): ClaudeUsageData | null {
	const bodyText = document.body.innerText;

	// Match "$XX.XX of $YYY.YY spent"
	const spendMatch = bodyText.match(/\$([0-9,]+(?:\.\d{2})?)\s+of\s+\$([0-9,]+(?:\.\d{2})?)\s+spent/i);
	if (!spendMatch) { return null; }

	const amountSpent = parseFloat(spendMatch[1].replace(/,/g, ''));
	const totalLimit = parseFloat(spendMatch[2].replace(/,/g, ''));

	// Match "Resets May 1" or "Resets January 15" etc.
	const resetMatch = bodyText.match(/Resets?\s+([A-Z][a-z]+\s+\d{1,2})/i);
	const resetDate = resetMatch ? resetMatch[1] : '';

	// Match plan type — look for common plan names near "usage limits" area
	let planType = '';
	const planMatch = bodyText.match(/\b(Enterprise|Pro|Team|Free|Max)\b/i);
	if (planMatch) {
		planType = planMatch[1];
	}

	if (isNaN(amountSpent) || isNaN(totalLimit) || totalLimit <= 0) { return null; }

	return {
		amountSpent,
		totalLimit,
		resetDate,
		planType,
		scrapedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// Budget calculation
// ---------------------------------------------------------------------------

function calculateBudgetMetrics(data: ClaudeUsageData): BudgetMetrics {
	const today = new Date();
	const resetDateObj = parseResetDate(data.resetDate, today);
	const billingStart = new Date(resetDateObj);
	billingStart.setMonth(billingStart.getMonth() - 1);

	const totalDays = Math.round((resetDateObj.getTime() - billingStart.getTime()) / 86_400_000);
	const daysElapsed = Math.max(1, Math.round((today.getTime() - billingStart.getTime()) / 86_400_000));
	const daysRemaining = Math.max(1, Math.round((resetDateObj.getTime() - today.getTime()) / 86_400_000));

	const spentPerDay = data.amountSpent / daysElapsed;
	const idealPerDay = data.totalLimit / totalDays;
	const dailyBudget = (data.totalLimit - data.amountSpent) / daysRemaining;
	const projectedSpend = spentPerDay * totalDays;
	const overUnderAmount = (spentPerDay - idealPerDay) * daysElapsed;
	const isOverBudget = spentPerDay > idealPerDay;

	const percentUsed = Math.round((data.amountSpent / data.totalLimit) * 100);
	const percentTimeElapsed = Math.round((daysElapsed / totalDays) * 100);

	return {
		daysElapsed,
		totalDays,
		daysRemaining,
		spentPerDay,
		idealPerDay,
		dailyBudget,
		overUnderAmount,
		isOverBudget,
		projectedSpend,
		percentUsed,
		percentTimeElapsed,
	};
}

function parseResetDate(resetStr: string, today: Date): Date {
	if (!resetStr) {
		// Fallback: assume resets on the 1st of next month
		const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
		return next;
	}

	const months: Record<string, number> = {
		january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
		july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
	};

	const parts = resetStr.trim().split(/\s+/);
	const monthName = (parts[0] ?? '').toLowerCase();
	const day = parseInt(parts[1] ?? '1', 10);
	const monthIndex = months[monthName];

	if (monthIndex === undefined || isNaN(day)) {
		const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
		return next;
	}

	let year = today.getFullYear();
	const candidate = new Date(year, monthIndex, day);
	// If the reset date is in the past, push to next year
	if (candidate.getTime() < today.getTime() - 86_400_000) {
		year++;
	}

	return new Date(year, monthIndex, day);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function saveSnapshot(data: ClaudeUsageData): Promise<void> {
	const todayStr = new Date().toISOString().slice(0, 10);
	const snapshot: UsageSnapshot = { ...data, date: todayStr };

	const stored = await chrome.storage.local.get(STORAGE_KEY);
	let history: UsageSnapshot[] = (stored[STORAGE_KEY] as UsageSnapshot[] | undefined) ?? [];

	// Deduplicate by date — keep latest
	history = history.filter(s => s.date !== todayStr);
	history.push(snapshot);

	// Cap at MAX_SNAPSHOTS (keep most recent)
	if (history.length > MAX_SNAPSHOTS) {
		history = history.slice(-MAX_SNAPSHOTS);
	}

	await chrome.storage.local.set({ [STORAGE_KEY]: history });
}

// ---------------------------------------------------------------------------
// Widget UI
// ---------------------------------------------------------------------------

function injectWidget(data: ClaudeUsageData, metrics: BudgetMetrics): void {
	if (document.getElementById(WIDGET_ID)) { return; }

	const host = document.createElement('div');
	host.id = WIDGET_ID;
	host.style.cssText = [
		'position: fixed',
		'bottom: 24px',
		'right: 24px',
		'z-index: 2147483640',
		'font-family: system-ui, -apple-system, sans-serif',
	].join(';');

	const shadow = host.attachShadow({ mode: 'closed' });

	const overColor = '#D97706';
	const underColor = '#059669';
	const statusColor = metrics.isOverBudget ? overColor : underColor;
	const statusIcon = metrics.isOverBudget ? '!' : '\u2713';
	const paceLabel = metrics.isOverBudget ? 'over budget' : 'under budget';
	const paceAmount = Math.abs(metrics.overUnderAmount).toFixed(2);

	const progressPercent = Math.min(metrics.percentUsed, 100);
	const progressColor = metrics.percentUsed > metrics.percentTimeElapsed ? overColor : underColor;

	shadow.innerHTML = `
		<style>
			:host { all: initial; }
			* { box-sizing: border-box; margin: 0; padding: 0; }
			.tracker {
				width: 280px;
				background: #1a1a1a;
				border: 1px solid #333;
				border-radius: 12px;
				color: #f5f5f4;
				font-size: 13px;
				line-height: 1.5;
				box-shadow: 0 12px 40px rgba(0,0,0,0.4);
				overflow: hidden;
			}
			.header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 10px 14px;
				background: #222;
				border-bottom: 1px solid #333;
				cursor: pointer;
				user-select: none;
			}
			.header-title {
				font-weight: 600;
				font-size: 13px;
				display: flex;
				align-items: center;
				gap: 6px;
			}
			.header-badge {
				font-size: 11px;
				padding: 1px 6px;
				border-radius: 4px;
				background: ${statusColor}22;
				color: ${statusColor};
				font-weight: 600;
			}
			.collapse-btn {
				background: none;
				border: none;
				color: #888;
				font-size: 16px;
				cursor: pointer;
				padding: 0 4px;
				line-height: 1;
			}
			.collapse-btn:hover { color: #ccc; }
			.body {
				padding: 12px 14px;
				display: flex;
				flex-direction: column;
				gap: 10px;
			}
			.body.collapsed { display: none; }
			.spent-row {
				display: flex;
				justify-content: space-between;
				align-items: baseline;
			}
			.spent-amount {
				font-size: 18px;
				font-weight: 700;
			}
			.spent-limit {
				color: #888;
				font-size: 12px;
			}
			.progress-track {
				height: 6px;
				background: #333;
				border-radius: 3px;
				overflow: hidden;
				position: relative;
			}
			.progress-fill {
				height: 100%;
				border-radius: 3px;
				background: ${progressColor};
				width: ${progressPercent}%;
				transition: width 0.3s ease;
			}
			.progress-ideal {
				position: absolute;
				top: -2px;
				bottom: -2px;
				width: 2px;
				background: #888;
				left: ${Math.min(metrics.percentTimeElapsed, 100)}%;
			}
			.metrics {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.metric {
				display: flex;
				justify-content: space-between;
				font-size: 12px;
			}
			.metric-label { color: #999; }
			.metric-value { font-weight: 600; }
			.status {
				font-size: 12px;
				font-weight: 600;
				color: ${statusColor};
				display: flex;
				align-items: center;
				gap: 4px;
			}
			.status-icon {
				width: 16px;
				height: 16px;
				border-radius: 50%;
				background: ${statusColor}22;
				color: ${statusColor};
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 10px;
				font-weight: 700;
			}
			.divider {
				border: none;
				border-top: 1px solid #333;
			}
			.plan-tag {
				font-size: 10px;
				color: #666;
				text-align: right;
			}
		</style>
		<div class="tracker">
			<div class="header">
				<span class="header-title">
					Usage Tracker
					<span class="header-badge">${metrics.percentUsed}%</span>
				</span>
				<button class="collapse-btn" title="Collapse">\u2212</button>
			</div>
			<div class="body">
				<div class="spent-row">
					<span class="spent-amount">$${data.amountSpent.toFixed(2)}</span>
					<span class="spent-limit">of $${data.totalLimit.toFixed(2)}</span>
				</div>
				<div class="progress-track">
					<div class="progress-fill"></div>
					<div class="progress-ideal" title="Ideal pace (${metrics.percentTimeElapsed}% of period)"></div>
				</div>
				<div class="status">
					<span class="status-icon">${statusIcon}</span>
					$${paceAmount} ${paceLabel}
				</div>
				<hr class="divider">
				<div class="metrics">
					<div class="metric">
						<span class="metric-label">Daily budget</span>
						<span class="metric-value">$${metrics.dailyBudget.toFixed(2)}/day</span>
					</div>
					<div class="metric">
						<span class="metric-label">Current pace</span>
						<span class="metric-value">$${metrics.spentPerDay.toFixed(2)}/day</span>
					</div>
					<div class="metric">
						<span class="metric-label">Projected total</span>
						<span class="metric-value" style="color: ${metrics.projectedSpend > data.totalLimit ? overColor : underColor}">$${metrics.projectedSpend.toFixed(2)}</span>
					</div>
					<div class="metric">
						<span class="metric-label">Days remaining</span>
						<span class="metric-value">${metrics.daysRemaining} of ${metrics.totalDays}</span>
					</div>
					<div class="metric">
						<span class="metric-label">Resets</span>
						<span class="metric-value">${data.resetDate || 'Unknown'}</span>
					</div>
				</div>
				${data.planType ? `<div class="plan-tag">${data.planType} plan</div>` : ''}
			</div>
		</div>
	`;

	// Collapse/expand toggle
	const collapseBtn = shadow.querySelector('.collapse-btn') as HTMLButtonElement;
	const body = shadow.querySelector('.body') as HTMLElement;
	const header = shadow.querySelector('.header') as HTMLElement;

	const toggle = () => {
		const collapsed = body.classList.toggle('collapsed');
		collapseBtn.textContent = collapsed ? '+' : '\u2212';
	};

	collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
	header.addEventListener('click', toggle);

	document.body.appendChild(host);
}
