/**
 * F-012: Team Knowledge Base — Keyword Matcher
 *
 * Finds relevant knowledge entries for a given review context (diff or file
 * content) using keyword-based matching. This is a lightweight approach that
 * works without the RAG system (F-009); when RAG is available it can be
 * replaced with semantic similarity search.
 */
import type {
	KnowledgeYamlConfig,
	KnowledgeDecision,
	KnowledgePattern,
	MatchedKnowledge,
	KnowledgeMatchResult,
} from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Finds knowledge entries relevant to the given code context.
 *
 * Scoring is based on keyword overlap between the entry's searchable text
 * (title, description, tags) and the review content (diff / file source).
 *
 * @param knowledge  Parsed knowledge YAML config
 * @param content    The diff or file content being reviewed
 * @param maxResults Maximum entries to return (default 10)
 * @returns Sorted matches with relevance scores
 */
export function matchKnowledge(
	knowledge: KnowledgeYamlConfig,
	content: string,
	maxResults: number = 10
): KnowledgeMatchResult {
	const matches: MatchedKnowledge[] = [];
	const contentTokens = tokenize(content);

	let totalEntries = 0;

	// Score decisions
	if (knowledge.decisions) {
		for (const d of knowledge.decisions) {
			totalEntries++;
			const searchable = buildDecisionSearchText(d);
			const relevance = scoreRelevance(searchable, contentTokens);
			if (relevance > 0) {
				matches.push({
					type: 'decision',
					title: `[${d.id}] ${d.title}`,
					content: formatDecision(d),
					relevance,
				});
			}
		}
	}

	// Score patterns
	if (knowledge.patterns) {
		for (const p of knowledge.patterns) {
			totalEntries++;
			const searchable = buildPatternSearchText(p);
			const relevance = scoreRelevance(searchable, contentTokens);
			if (relevance > 0) {
				matches.push({
					type: 'pattern',
					title: `[${p.id}] ${p.name}`,
					content: formatPattern(p),
					relevance,
				});
			}
		}
	}

	// Rules always match (they are general team conventions)
	if (knowledge.rules) {
		for (const r of knowledge.rules) {
			if (typeof r !== 'string' || !r.trim()) { continue; }
			totalEntries++;
			matches.push({
				type: 'rule',
				title: r.length > 60 ? r.slice(0, 57) + '...' : r,
				content: r,
				relevance: 0.5, // baseline relevance — rules always apply
			});
		}
	}

	// Sort by relevance descending, then cap at maxResults
	matches.sort((a, b) => b.relevance - a.relevance);

	return {
		matches: matches.slice(0, maxResults),
		totalEntries,
	};
}

// ---------------------------------------------------------------------------
// Tokenization & scoring
// ---------------------------------------------------------------------------

/** Lowercase word tokens extracted from text. */
function tokenize(text: string): Set<string> {
	const words = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g);
	return new Set(words ?? []);
}

/**
 * Scores the relevance of a knowledge entry against the review content.
 * Returns 0.0 – 1.0 based on the fraction of entry keywords found in the content.
 */
function scoreRelevance(entrySearchText: string, contentTokens: Set<string>): number {
	const entryTokens = tokenize(entrySearchText);
	if (entryTokens.size === 0) { return 0; }

	let hits = 0;
	for (const token of entryTokens) {
		if (contentTokens.has(token)) {
			hits++;
		}
	}

	return hits / entryTokens.size;
}

// ---------------------------------------------------------------------------
// Search text builders
// ---------------------------------------------------------------------------

function buildDecisionSearchText(d: KnowledgeDecision): string {
	const parts = [d.id, d.title, d.decision, d.context ?? ''];
	if (d.tags) { parts.push(...d.tags); }
	return parts.join(' ');
}

function buildPatternSearchText(p: KnowledgePattern): string {
	const parts = [p.id, p.name, p.description, p.example ?? ''];
	if (p.tags) { parts.push(...p.tags); }
	return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Formatters (for prompt injection)
// ---------------------------------------------------------------------------

function formatDecision(d: KnowledgeDecision): string {
	let text = `**[${d.id}] ${d.title}**: ${d.decision}`;
	if (d.context) { text += `\n  Context: ${d.context}`; }
	if (d.date) { text += `\n  Date: ${d.date}`; }
	return text;
}

function formatPattern(p: KnowledgePattern): string {
	let text = `**[${p.id}] ${p.name}**: ${p.description}`;
	if (p.example) {
		text += `\n\`\`\`\n${p.example.trim()}\n\`\`\``;
	}
	return text;
}
