export interface ClaudeUsageData {
	amountSpent: number;
	totalLimit: number;
	resetDate: string;
	planType: string;
	scrapedAt: string;
}

export interface UsageSnapshot extends ClaudeUsageData {
	date: string;
}

export interface BudgetMetrics {
	daysElapsed: number;
	totalDays: number;
	daysRemaining: number;
	spentPerDay: number;
	idealPerDay: number;
	dailyBudget: number;
	overUnderAmount: number;
	isOverBudget: boolean;
	projectedSpend: number;
	percentUsed: number;
	percentTimeElapsed: number;
}
