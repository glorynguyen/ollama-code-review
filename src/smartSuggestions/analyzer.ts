/**
 * F-049: Smart Review Suggestions — Analyzer
 *
 * Analyzes review results and generates contextual suggestions for
 * next actions: auto-fixable findings, profile switches, trend
 * warnings, security follow-ups, and workflow recommendations.
 */

import type {
	SmartSuggestion,
	SuggestionInput,
	SuggestionResult,
	SuggestionCategory,
	SuggestionPriority,
} from './types';

// ─── Security detection patterns ─────────────────────────────────────────────

const SECURITY_FILE_PATTERNS = [
	/auth/i, /login/i, /session/i, /token/i, /password/i,
	/credential/i, /secret/i, /crypto/i, /encrypt/i,
	/permission/i, /access/i, /security/i, /oauth/i,
	/jwt/i, /api[_-]?key/i, /middleware/i,
];

const PERFORMANCE_FILE_PATTERNS = [
	/database/i, /query/i, /cache/i, /pool/i,
	/worker/i, /stream/i, /buffer/i, /batch/i,
	/index/i, /migration/i, /connection/i,
];

// ─── Suggestion generators ───────────────────────────────────────────────────

/**
 * Generate fix-related suggestions based on fixable finding counts.
 */
export function generateFixSuggestions(input: SuggestionInput): SmartSuggestion[] {
	const suggestions: SmartSuggestion[] = [];
	const fixable = input.fixableCount ?? 0;
	const total = input.totalFindings ?? 0;

	if (fixable > 0) {
		const priority: SuggestionPriority = fixable >= 5 ? 'high' : fixable >= 2 ? 'medium' : 'low';
		suggestions.push({
			id: 'fix-all-findings',
			category: 'fix',
			priority,
			title: `${fixable} finding${fixable > 1 ? 's are' : ' is'} auto-fixable`,
			description: `Use "Fix All Findings" to generate AI fixes for ${fixable} of ${total} finding${total > 1 ? 's' : ''} that have file and line references.`,
			command: 'ollama-code-review.fixAllFindings',
			icon: 'wrench',
		});
	}

	return suggestions;
}

/**
 * Generate profile-related suggestions based on detected file patterns and categories.
 */
export function generateProfileSuggestions(input: SuggestionInput): SmartSuggestion[] {
	const suggestions: SmartSuggestion[] = [];
	const { activeProfile, filesReviewed, categories } = input;

	// Detect security-sensitive files
	const securityFiles = filesReviewed.filter(f =>
		SECURITY_FILE_PATTERNS.some(p => p.test(f))
	);

	if (securityFiles.length > 0 && activeProfile !== 'security') {
		suggestions.push({
			id: 'suggest-security-profile',
			category: 'security',
			priority: 'high',
			title: `Security-sensitive files detected`,
			description: `${securityFiles.length} file${securityFiles.length > 1 ? 's' : ''} (${securityFiles.slice(0, 3).join(', ')}${securityFiles.length > 3 ? '…' : ''}) touch auth/security logic. Run a security-focused review for deeper analysis.`,
			command: 'ollama-code-review.reviewChanges',
			icon: 'shield',
		});
	}

	// Detect performance-sensitive files
	const perfFiles = filesReviewed.filter(f =>
		PERFORMANCE_FILE_PATTERNS.some(p => p.test(f))
	);

	if (perfFiles.length > 0 && activeProfile !== 'performance') {
		const perfIssues = categories?.['performance'] ?? 0;
		if (perfIssues > 0) {
			suggestions.push({
				id: 'suggest-performance-profile',
				category: 'performance',
				priority: 'medium',
				title: `Performance issues in database/cache files`,
				description: `${perfIssues} performance concern${perfIssues > 1 ? 's' : ''} detected in ${perfFiles.slice(0, 2).join(', ')}. Run a performance-focused review for detailed analysis.`,
				command: 'ollama-code-review.reviewChanges',
				icon: 'dashboard',
			});
		}
	}

	// Suggest switching from general to a more specific profile based on categories
	if (activeProfile === 'general' && categories) {
		const topCategory = Object.entries(categories)
			.filter(([cat]) => cat !== 'other')
			.sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))[0];

		if (topCategory && (topCategory[1] ?? 0) >= 3) {
			const [cat, count] = topCategory;
			const profileMap: Record<string, string> = {
				security: 'security',
				performance: 'performance',
				accessibility: 'accessibility',
				style: 'strict',
			};
			const suggestedProfile = profileMap[cat];
			if (suggestedProfile) {
				suggestions.push({
					id: `suggest-profile-${cat}`,
					category: 'profile',
					priority: 'medium',
					title: `Consider using the "${suggestedProfile}" profile`,
					description: `${count} ${cat} issue${(count ?? 0) > 1 ? 's' : ''} found. The "${suggestedProfile}" profile provides deeper ${cat} analysis.`,
					command: 'ollama-code-review.selectProfile',
					icon: 'filter',
				});
			}
		}
	}

	return suggestions;
}

/**
 * Generate trend-based suggestions from review history.
 */
export function generateTrendSuggestions(input: SuggestionInput): SmartSuggestion[] {
	const suggestions: SmartSuggestion[] = [];
	const { recentScores, score } = input;

	if (!recentScores || recentScores.length < 3) {
		return suggestions;
	}

	// Check for declining score trend (last 3 reviews)
	const recent3 = recentScores.slice(0, 3);
	const avgRecent = recent3.reduce((sum, s) => sum + s.score, 0) / recent3.length;

	if (score < avgRecent - 15) {
		suggestions.push({
			id: 'trend-declining-quality',
			category: 'trend',
			priority: 'high',
			title: 'Quality score declining',
			description: `This review scored ${score}/100, which is ${Math.round(avgRecent - score)} points below your recent average (${Math.round(avgRecent)}/100). Consider reviewing more carefully before committing.`,
			command: 'ollama-code-review.showReviewHistory',
			icon: 'graph-line',
		});
	}

	// Check for recurring issues in the same files
	const currentFiles = new Set(input.filesReviewed);
	const recentFilesWithIssues = recentScores
		.slice(0, 10)
		.filter(s => s.score < 80 && s.filesReviewed)
		.flatMap(s => s.filesReviewed!)
		.filter(f => currentFiles.has(f));

	const repeatedFiles = [...new Set(recentFilesWithIssues)]
		.filter(f => recentFilesWithIssues.filter(rf => rf === f).length >= 2);

	if (repeatedFiles.length > 0) {
		suggestions.push({
			id: 'trend-recurring-issues',
			category: 'trend',
			priority: 'medium',
			title: `Recurring issues in ${repeatedFiles.length} file${repeatedFiles.length > 1 ? 's' : ''}`,
			description: `${repeatedFiles.slice(0, 3).join(', ')} ha${repeatedFiles.length > 1 ? 've' : 's'} had findings in multiple recent reviews. Consider refactoring.`,
			command: 'ollama-code-review.showAnalyticsDashboard',
			icon: 'history',
		});
	}

	return suggestions;
}

/**
 * Generate workflow suggestions (commit, export, etc).
 */
export function generateWorkflowSuggestions(input: SuggestionInput): SmartSuggestion[] {
	const suggestions: SmartSuggestion[] = [];
	const { score, findingCounts } = input;

	// High quality score — suggest committing
	if (score >= 90 && findingCounts.critical === 0 && findingCounts.high === 0) {
		suggestions.push({
			id: 'workflow-commit',
			category: 'workflow',
			priority: 'low',
			title: 'Code looks good — ready to commit',
			description: `Quality score ${score}/100 with no critical or high findings. Consider committing your changes.`,
			command: 'ollama-code-review.generateCommitMessage',
			icon: 'git-commit',
		});
	}

	// Critical findings — suggest urgent action
	if (findingCounts.critical > 0) {
		suggestions.push({
			id: 'workflow-critical',
			category: 'workflow',
			priority: 'high',
			title: `${findingCounts.critical} critical finding${findingCounts.critical > 1 ? 's' : ''} require attention`,
			description: 'Critical findings may indicate security vulnerabilities or data loss risks. Address these before committing.',
			icon: 'error',
		});
	}

	return suggestions;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Generate all smart suggestions for a completed review.
 * Combines fix, profile, trend, and workflow suggestions, then sorts by priority.
 */
export function generateSmartSuggestions(input: SuggestionInput): SuggestionResult {
	const allSuggestions: SmartSuggestion[] = [
		...generateFixSuggestions(input),
		...generateProfileSuggestions(input),
		...generateTrendSuggestions(input),
		...generateWorkflowSuggestions(input),
	];

	// Sort by priority: high > medium > low
	const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
	allSuggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

	// Limit to top 5 suggestions to avoid overwhelming the user
	const suggestions = allSuggestions.slice(0, 5);

	return {
		suggestions,
		generatedAt: new Date().toISOString(),
	};
}
