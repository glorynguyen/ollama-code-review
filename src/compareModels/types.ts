export interface ModelComparisonEntry {
	model: string;
	provider: string;
	review: string;
	durationMs: number;
	tokenCount?: { input?: number; output?: number };
	score: number;
	findingCounts: { critical: number; high: number; medium: number; low: number; info: number };
	error?: string;
}

export interface ComparisonResult {
	diff: string;
	entries: ModelComparisonEntry[];
	timestamp: string;
	commonFindings: string[];
}
