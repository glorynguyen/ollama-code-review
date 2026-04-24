import { initUsageTracker, type UsageData } from './usageBase';

initUsageTracker('copilot', scrapeUsageData);

function scrapeUsageData(): UsageData | null {
	const container = document.getElementById('copilot-overages-usage');
	if (!container) { return null; }

	const bodyText = container.innerText;

	// The user provided:
	// <div id="copilot-overages-usage" ...>
	//   ...
	//   <span ...>Premium requests</span>
	//   <div ...>83.0%</div>
	//   ...
	// </div>

	const percentMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*%/);
	if (!percentMatch) { return null; }

	const percentUsed = parseFloat(percentMatch[1]);

	// GitHub might also have reset date on the page, let's look for it
	// Usually it's near "billing cycle" or "renews on"
	let resetDate = '';
	const fullBodyText = document.body.innerText;
	const resetMatch = fullBodyText.match(/(?:renews|resets|billing cycle ends)\s+(?:on\s+)?([A-Z][a-z]+\s+\d{1,2})/i);
	if (resetMatch) {
		resetDate = resetMatch[1];
	} else {
		// Default to the 1st of next month as per user hint
		const nextMonth = new Date();
		nextMonth.setMonth(nextMonth.getMonth() + 1);
		nextMonth.setDate(1);
		const monthName = nextMonth.toLocaleString('default', { month: 'long' });
		resetDate = `${monthName} 1`;
	}

	return {
		provider: 'copilot',
		amountSpent: percentUsed,
		totalLimit: 100,
		resetDate,
		planType: 'Copilot',
		scrapedAt: new Date().toISOString(),
	};
}
