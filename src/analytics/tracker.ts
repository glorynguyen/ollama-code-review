/**
 * F-011: Review Analytics — Category Tracker
 *
 * Extracts issue categories from AI review Markdown text and provides
 * utility functions for computing analytics aggregates from review history.
 */

import type { IssueCategory, ReviewScore } from '../reviewScore';
import type { FindingCounts } from '../notifications';

// ─── Category extraction ────────────────────────────────────────────────────

/** Keyword groups that map to issue categories. */
const CATEGORY_PATTERNS: Record<IssueCategory, RegExp[]> = {
	security: [
		/\bsecurity\b/i, /\binjection\b/i, /\bxss\b/i, /\bcross-site\b/i,
		/\bcsrf\b/i, /\bauth(entication|orization)?\b/i, /\bsecret\b/i,
		/\bvulnerabilit/i, /\bexposure\b/i, /\bsanitiz/i, /\bencrypt/i,
		/\bcredential/i, /\bpath.?traversal/i, /\bowasp\b/i,
	],
	performance: [
		/\bperformance\b/i, /\bmemory.?leak/i, /\bn\+1\b/i,
		/\bcomplexity\b/i, /\bre-?render/i, /\bcaching\b/i,
		/\boptimiz/i, /\bbottleneck/i, /\blatency\b/i,
		/\bbundle.?size/i, /\blazy.?load/i,
	],
	style: [
		/\bstyle\b/i, /\bnaming\b/i, /\bconvention\b/i,
		/\bformat/i, /\binconsistent/i, /\breadability\b/i,
		/\blint/i, /\bindentation\b/i, /\bwhitespace\b/i,
	],
	bugs: [
		/\bbug\b/i, /\berror\b/i, /\brace.?condition/i,
		/\bnull\b/i, /\bundefined\b/i, /\bcrash/i,
		/\boff-?by-?one/i, /\bedge.?case/i, /\bexception\b/i,
		/\btype.?error/i, /\breference.?error/i,
	],
	maintainability: [
		/\bmaintainab/i, /\brefactor/i, /\bcomplexity\b/i,
		/\bduplica/i, /\bcoupling\b/i, /\bcohesion\b/i,
		/\bsolid\b/i, /\bmagic.?number/i, /\bdead.?code/i,
		/\btechnical.?debt/i,
	],
	accessibility: [
		/\baccessib/i, /\baria\b/i, /\bscreen.?reader/i,
		/\bkeyboard\b/i, /\bcolor.?contrast/i, /\bsemantic\b/i,
		/\balt.?text/i, /\bfocus\b/i,
	],
	documentation: [
		/\bdocument/i, /\bjsdoc\b/i, /\btsdoc\b/i,
		/\bcomment/i, /\breadme\b/i, /\bchangelog\b/i,
	],
	other: [],
};

/**
 * Parse an AI review text to extract issue category counts.
 * Scans each line for category-specific keywords and tallies matches.
 */
export function parseIssueCategories(reviewText: string): Partial<Record<IssueCategory, number>> {
	const categories: Partial<Record<IssueCategory, number>> = {};
	const lines = reviewText.split('\n');

	// Only scan lines that look like findings (contain severity indicators or bullet markers)
	const findingLines = lines.filter(line => {
		const lower = line.toLowerCase();
		return /severity|🔴|🟠|🟡|🟢|ℹ️|\*\*|^[\s]*[-*]\s/.test(lower);
	});

	for (const line of findingLines) {
		for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS) as [IssueCategory, RegExp[]][]) {
			if (category === 'other') { continue; }
			for (const pattern of patterns) {
				if (pattern.test(line)) {
					categories[category] = (categories[category] ?? 0) + 1;
					break; // Count each line at most once per category
				}
			}
		}
	}

	return categories;
}

/**
 * Extract changed file paths from a unified diff string.
 * Returns unique file paths from `+++ b/...` headers.
 */
export function extractFilesFromDiff(diff: string): string[] {
	const files = new Set<string>();
	const regex = /^\+\+\+ b\/(.+)$/gm;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(diff)) !== null) {
		files.add(match[1]);
	}
	return Array.from(files);
}

// ─── Aggregation helpers ────────────────────────────────────────────────────

export interface AnalyticsSummary {
	totalReviews: number;
	averageScore: number;
	bestScore: number;
	worstScore: number;
	totalIssues: number;
	reviewsThisWeek: number;
	reviewsThisMonth: number;

	/** Severity distribution across all reviews */
	severityDistribution: FindingCounts;

	/** Category distribution (summed across all reviews) */
	categoryDistribution: Partial<Record<IssueCategory, number>>;

	/** Review type breakdown */
	reviewTypeBreakdown: Record<string, number>;

	/** Model usage counts */
	modelUsage: Record<string, number>;

	/** Profile usage counts */
	profileUsage: Record<string, number>;

	/** Most frequently reviewed files (top 15) */
	topFiles: Array<{ file: string; count: number }>;

	/** Average review duration in ms (only from entries that have it) */
	averageDurationMs: number | undefined;

	/** Score trend: weekly averages for the last 12 weeks */
	weeklyScores: Array<{ weekLabel: string; avgScore: number; count: number }>;
}

/**
 * Compute a comprehensive analytics summary from the full score history.
 */
export function computeAnalytics(scores: ReviewScore[]): AnalyticsSummary {
	const now = Date.now();
	const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
	const oneMonthMs = 30 * 24 * 60 * 60 * 1000;

	const severity: FindingCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
	const categoryDist: Partial<Record<IssueCategory, number>> = {};
	const typeCounts: Record<string, number> = {};
	const modelCounts: Record<string, number> = {};
	const profileCounts: Record<string, number> = {};
	const fileCounts: Record<string, number> = {};
	let totalIssues = 0;
	let reviewsThisWeek = 0;
	let reviewsThisMonth = 0;
	let durationSum = 0;
	let durationCount = 0;

	for (const s of scores) {
		const ts = new Date(s.timestamp).getTime();
		if (now - ts < oneWeekMs) { reviewsThisWeek++; }
		if (now - ts < oneMonthMs) { reviewsThisMonth++; }

		// Severity
		if (s.findingCounts) {
			severity.critical += s.findingCounts.critical;
			severity.high     += s.findingCounts.high;
			severity.medium   += s.findingCounts.medium;
			severity.low      += s.findingCounts.low;
			severity.info     += s.findingCounts.info;
			totalIssues += s.findingCounts.critical + s.findingCounts.high + s.findingCounts.medium + s.findingCounts.low;
		}

		// Categories
		if (s.categories) {
			for (const [cat, count] of Object.entries(s.categories)) {
				categoryDist[cat as IssueCategory] = (categoryDist[cat as IssueCategory] ?? 0) + (count ?? 0);
			}
		}

		// Review type
		const rtype = s.reviewType ?? 'unknown';
		typeCounts[rtype] = (typeCounts[rtype] ?? 0) + 1;

		// Model
		modelCounts[s.model] = (modelCounts[s.model] ?? 0) + 1;

		// Profile
		const prof = s.profile || 'general';
		profileCounts[prof] = (profileCounts[prof] ?? 0) + 1;

		// Files
		if (s.filesReviewed) {
			for (const f of s.filesReviewed) {
				fileCounts[f] = (fileCounts[f] ?? 0) + 1;
			}
		}

		// Duration
		if (s.durationMs !== undefined) {
			durationSum += s.durationMs;
			durationCount++;
		}
	}

	const totalReviews = scores.length;
	const averageScore = totalReviews
		? Math.round(scores.reduce((a, b) => a + b.score, 0) / totalReviews)
		: 0;
	const bestScore = totalReviews ? Math.max(...scores.map(s => s.score)) : 0;
	const worstScore = totalReviews ? Math.min(...scores.map(s => s.score)) : 100;

	// Top files
	const topFiles = Object.entries(fileCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15)
		.map(([file, count]) => ({ file, count }));

	// Weekly score trend (last 12 weeks)
	const weeklyScores = computeWeeklyTrend(scores, 12);

	return {
		totalReviews,
		averageScore,
		bestScore,
		worstScore,
		totalIssues,
		reviewsThisWeek,
		reviewsThisMonth,
		severityDistribution: severity,
		categoryDistribution: categoryDist,
		reviewTypeBreakdown: typeCounts,
		modelUsage: modelCounts,
		profileUsage: profileCounts,
		topFiles,
		averageDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : undefined,
		weeklyScores,
	};
}

/**
 * Compute weekly average scores for the last N weeks.
 */
function computeWeeklyTrend(scores: ReviewScore[], weeks: number): Array<{ weekLabel: string; avgScore: number; count: number }> {
	const now = new Date();
	const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
	const result: Array<{ weekLabel: string; avgScore: number; count: number }> = [];

	for (let i = weeks - 1; i >= 0; i--) {
		const weekStart = new Date(now.getTime() - (i + 1) * oneWeekMs);
		const weekEnd = new Date(now.getTime() - i * oneWeekMs);
		const weekScores = scores.filter(s => {
			const ts = new Date(s.timestamp).getTime();
			return ts >= weekStart.getTime() && ts < weekEnd.getTime();
		});

		const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
		const avg = weekScores.length
			? Math.round(weekScores.reduce((a, b) => a + b.score, 0) / weekScores.length)
			: 0;
		result.push({ weekLabel: label, avgScore: avg, count: weekScores.length });
	}

	return result;
}

/**
 * Export review data as CSV string.
 */
export function exportAsCSV(scores: ReviewScore[]): string {
	const header = 'id,timestamp,repo,branch,model,profile,score,correctness,security,maintainability,performance,critical,high,medium,low,info,reviewType,durationMs';
	const rows = scores.map(s => {
		const c = s.findingCounts;
		return [
			s.id,
			s.timestamp,
			`"${s.repo}"`,
			`"${s.branch}"`,
			`"${s.model}"`,
			`"${s.profile}"`,
			s.score,
			s.correctness,
			s.security,
			s.maintainability,
			s.performance,
			c.critical,
			c.high,
			c.medium,
			c.low,
			c.info,
			s.reviewType ?? '',
			s.durationMs ?? '',
		].join(',');
	});
	return [header, ...rows].join('\n');
}

/**
 * Export review data as a JSON string.
 */
export function exportAsJSON(scores: ReviewScore[]): string {
	return JSON.stringify(scores, null, 2);
}
