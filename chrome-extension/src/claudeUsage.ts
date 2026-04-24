import { initUsageTracker, type UsageData } from './usageBase';

initUsageTracker('claude', scrapeUsageData);

function scrapeUsageData(): UsageData | null {
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
		provider: 'claude',
		amountSpent,
		totalLimit,
		resetDate,
		planType,
		scrapedAt: new Date().toISOString(),
	};
}
