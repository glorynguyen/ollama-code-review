/**
 * F-037: Model metadata registry and affinity matrices
 */

import type { ModelProfile, ModelTier, TaskType, DiffSizeBucket } from './types';

/** All known cloud + Ollama models */
export const MODEL_PROFILES: ModelProfile[] = [
	// Claude
	{
		modelId: 'claude-opus-4-20250514',
		providerName: 'claude',
		tier: 'flagship',
		languageBonus: { ts: 0.2, tsx: 0.2, js: 0.1, jsx: 0.1 },
	},
	{
		modelId: 'claude-sonnet-4-20250514',
		providerName: 'claude',
		tier: 'balanced',
		languageBonus: { ts: 0.15, tsx: 0.15 },
	},
	{
		modelId: 'claude-3-7-sonnet-20250219',
		providerName: 'claude',
		tier: 'balanced',
		languageBonus: { ts: 0.15, tsx: 0.15 },
	},
	// Kimi
	{ modelId: 'kimi-k2.5:cloud', providerName: 'kimi', tier: 'balanced' },
	{
		modelId: 'qwen3-coder:480b-cloud',
		providerName: 'qwen',
		tier: 'flagship',
		languageBonus: { ts: 0.25, py: 0.25, js: 0.2 },
	},
	// GLM
	{ modelId: 'glm-4.7:cloud', providerName: 'glm', tier: 'balanced' },
	{ modelId: 'glm-4.7-flash', providerName: 'glm', tier: 'fast' },
	// Gemini
	{ modelId: 'gemini-2.5-flash', providerName: 'gemini', tier: 'fast' },
	{ modelId: 'gemini-2.5-pro', providerName: 'gemini', tier: 'balanced' },
	// Mistral
	{
		modelId: 'mistral-large-latest',
		providerName: 'mistral',
		tier: 'flagship',
		languageBonus: { ts: 0.2, py: 0.2 },
	},
	{ modelId: 'mistral-small-latest', providerName: 'mistral', tier: 'fast' },
	{
		modelId: 'codestral-latest',
		providerName: 'mistral',
		tier: 'code-specialist',
		languageBonus: { ts: 0.3, js: 0.3, py: 0.2 },
	},
	// MiniMax
	{ modelId: 'MiniMax-M2.5', providerName: 'minimax', tier: 'fast' },
	// Hugging Face (catch-all)
	{ modelId: 'huggingface', providerName: 'huggingface', tier: 'balanced', languageBonus: { py: 0.2, ts: 0.15 } },
	// OpenAI-compatible (catch-all)
	{ modelId: 'openai-compatible', providerName: 'openai-compatible', tier: 'balanced' },
];

/** Classify an Ollama model name into a tier */
export function classifyOllamaModel(name: string): ModelTier {
	const lower = name.toLowerCase();
	if (lower.includes('coder') || lower.includes('code')) return 'code-specialist';
	if (lower.includes('70b') || lower.includes('405b') || lower.includes('llama3') || lower.includes('dolphin')) {
		return 'flagship';
	}
	return 'local';
}

/** Task type affinities by tier (0–1) */
export const TIER_TASK_AFFINITY: Record<ModelTier, Record<TaskType, number>> = {
	flagship: {
		review: 0.9,
		'commit-message': 0.3,
		explain: 0.7,
		'generate-tests': 0.5,
		fix: 0.6,
		document: 0.4,
		diagram: 0.5,
		'agent-review': 1.0,
		'version-bump': 0.5,
		'file-review': 0.8,
	},
	balanced: {
		review: 0.7,
		'commit-message': 0.5,
		explain: 0.8,
		'generate-tests': 0.6,
		fix: 0.7,
		document: 0.6,
		diagram: 0.7,
		'agent-review': 0.6,
		'version-bump': 0.6,
		'file-review': 0.7,
	},
	fast: {
		review: 0.4,
		'commit-message': 0.9,
		explain: 0.6,
		'generate-tests': 0.4,
		fix: 0.5,
		document: 0.7,
		diagram: 0.6,
		'agent-review': 0.2,
		'version-bump': 0.7,
		'file-review': 0.5,
	},
	'code-specialist': {
		review: 0.6,
		'commit-message': 0.5,
		explain: 0.5,
		'generate-tests': 0.9,
		fix: 0.9,
		document: 0.7,
		diagram: 0.4,
		'agent-review': 0.5,
		'version-bump': 0.6,
		'file-review': 0.7,
	},
	local: {
		review: 0.5,
		'commit-message': 0.7,
		explain: 0.5,
		'generate-tests': 0.6,
		fix: 0.5,
		document: 0.5,
		diagram: 0.4,
		'agent-review': 0.3,
		'version-bump': 0.5,
		'file-review': 0.6,
	},
};

/** Diff size affinities by tier */
export const TIER_SIZE_AFFINITY: Record<ModelTier, Record<DiffSizeBucket, number>> = {
	flagship: { small: 0.3, medium: 0.7, large: 1.0 },
	balanced: { small: 0.6, medium: 0.8, large: 0.6 },
	fast: { small: 0.9, medium: 0.6, large: 0.3 },
	'code-specialist': { small: 0.7, medium: 0.7, large: 0.5 },
	local: { small: 0.8, medium: 0.6, large: 0.3 },
};

/** Review profile affinities by tier */
export const PROFILE_TIER_AFFINITY: Record<string, Record<ModelTier, number>> = {
	security: { flagship: 1.0, balanced: 0.6, fast: 0.2, 'code-specialist': 0.4, local: 0.3 },
	performance: { flagship: 0.7, balanced: 0.7, fast: 0.4, 'code-specialist': 0.6, local: 0.4 },
	general: { flagship: 0.5, balanced: 0.8, fast: 0.7, 'code-specialist': 0.6, local: 0.7 },
	'compliance-owasp': { flagship: 0.95, balanced: 0.6, fast: 0.2, 'code-specialist': 0.5, local: 0.3 },
	'compliance-pci': { flagship: 0.95, balanced: 0.65, fast: 0.25, 'code-specialist': 0.5, local: 0.35 },
	'compliance-gdpr': { flagship: 0.9, balanced: 0.7, fast: 0.3, 'code-specialist': 0.4, local: 0.3 },
	'compliance-hipaa': { flagship: 0.95, balanced: 0.65, fast: 0.25, 'code-specialist': 0.45, local: 0.3 },
	'compliance-soc2': { flagship: 0.9, balanced: 0.7, fast: 0.3, 'code-specialist': 0.5, local: 0.35 },
	'compliance-nist': { flagship: 0.9, balanced: 0.65, fast: 0.25, 'code-specialist': 0.5, local: 0.3 },
};

const DEFAULT_PROFILE_AFFINITY: Record<ModelTier, number> = {
	flagship: 0.5,
	balanced: 0.8,
	fast: 0.7,
	'code-specialist': 0.6,
	local: 0.7,
};

/** Get profile affinity for a tier, with default fallback */
export function getProfileAffinity(profileName: string | undefined, tier: ModelTier): number {
	if (!profileName) return DEFAULT_PROFILE_AFFINITY[tier];
	return PROFILE_TIER_AFFINITY[profileName]?.[tier] ?? DEFAULT_PROFILE_AFFINITY[tier];
}
