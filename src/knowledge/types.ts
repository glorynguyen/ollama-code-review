/**
 * F-012: Team Knowledge Base — Types & Interfaces
 *
 * Shared types for the knowledge base system that allows teams to encode
 * architecture decisions, coding patterns, and review rules in a YAML file
 * checked into the repository.
 */

// ---------------------------------------------------------------------------
// Knowledge entry types
// ---------------------------------------------------------------------------

/** The kind of knowledge entry. */
export type KnowledgeEntryType = 'decision' | 'pattern' | 'rule';

/** A single architecture decision record. */
export interface KnowledgeDecision {
	id: string;
	title: string;
	context?: string;
	decision: string;
	date?: string;
	tags?: string[];
}

/** A reusable code pattern with an optional example snippet. */
export interface KnowledgePattern {
	id: string;
	name: string;
	description: string;
	example?: string;
	tags?: string[];
}

/** A simple team rule (plain string). */
export type KnowledgeRule = string;

// ---------------------------------------------------------------------------
// YAML schema
// ---------------------------------------------------------------------------

/**
 * Shape of the `.ollama-review-knowledge.yaml` file.
 * All top-level keys are optional.
 */
export interface KnowledgeYamlConfig {
	decisions?: KnowledgeDecision[];
	patterns?: KnowledgePattern[];
	rules?: KnowledgeRule[];
}

// ---------------------------------------------------------------------------
// Matcher result
// ---------------------------------------------------------------------------

/** A knowledge entry that matched the current review context. */
export interface MatchedKnowledge {
	type: KnowledgeEntryType;
	/** Human-readable title or name. */
	title: string;
	/** Full content to inject into the prompt. */
	content: string;
	/** Relevance score (higher = more relevant). */
	relevance: number;
}

/** Aggregated result of knowledge matching. */
export interface KnowledgeMatchResult {
	matches: MatchedKnowledge[];
	/** Number of entries evaluated. */
	totalEntries: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** VS Code settings for the knowledge base feature. */
export interface KnowledgeBaseConfig {
	/** Whether to load and inject knowledge base entries into reviews. */
	enabled: boolean;
	/** Maximum number of knowledge entries to inject per review. */
	maxEntries: number;
}
