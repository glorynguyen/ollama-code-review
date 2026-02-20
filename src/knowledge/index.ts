/**
 * F-012: Team Knowledge Base — Barrel exports
 */
export {
	loadKnowledgeBase,
	clearKnowledgeCache,
	getKnowledgeBaseConfig,
	formatKnowledgeForPrompt,
} from './loader';

export {
	matchKnowledge,
} from './matcher';

export type {
	KnowledgeEntryType,
	KnowledgeDecision,
	KnowledgePattern,
	KnowledgeRule,
	KnowledgeYamlConfig,
	MatchedKnowledge,
	KnowledgeMatchResult,
	KnowledgeBaseConfig,
} from './types';
