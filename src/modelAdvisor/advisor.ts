/**
 * F-037: Core scoring engine for model recommendation
 */

import * as vscode from 'vscode';
import axios from 'axios';
import type { ModelAdvisorInput, ModelAdvisorResult, ModelSuggestion, TaskType, DiffSizeBucket } from './types';
import { MODEL_PROFILES, classifyOllamaModel, TIER_TASK_AFFINITY, TIER_SIZE_AFFINITY, getProfileAffinity } from './profiles';
import type { ModelProfile } from './types';

/** Bucket a diff by character count: <2KB small, <20KB medium, >=20KB large */
export function bucketDiffSize(charCount: number): DiffSizeBucket {
	if (charCount < 2000) return 'small';
	if (charCount < 20000) return 'medium';
	return 'large';
}

/** Internal: model with score and reason */
interface ScoredModel extends ModelProfile {
	score: number;
	reason: string;
}

/**
 * Score a single model against the input using the 4-signal weighted heuristic.
 * Weights: task (0.35) + size (0.25) + profile (0.20) + language (0.20) = 1.0
 */
export function scoreModel(profile: ModelProfile, input: ModelAdvisorInput): { score: number; reason: string } {
	const tier = profile.tier;
	const bucket = bucketDiffSize(input.contentLength);

	// Signal 1: Task type (weight 0.35)
	const taskScore = TIER_TASK_AFFINITY[tier]?.[input.taskType] ?? 0.5;
	const taskComponent = 0.35 * taskScore;

	// Signal 2: Diff size (weight 0.25)
	const sizeScore = TIER_SIZE_AFFINITY[tier]?.[bucket] ?? 0.5;
	const sizeComponent = 0.25 * sizeScore;

	// Signal 3: Profile (weight 0.20)
	const profileScore = getProfileAffinity(input.activeProfile, tier);
	const profileComponent = 0.20 * profileScore;

	// Signal 4: Language (weight 0.20)
	let languageScore = 0.5; // neutral default
	if (profile.languageBonus && input.languages.length > 0) {
		const bonuses = input.languages
			.map(lang => profile.languageBonus?.[lang] ?? 0)
			.filter(b => b > 0);
		if (bonuses.length > 0) {
			// Boost from max bonus, capped at 1.0
			languageScore = Math.min(0.5 + Math.max(...bonuses), 1.0);
		}
	}
	const languageComponent = 0.20 * languageScore;

	// Composite score
	const finalScore = taskComponent + sizeComponent + profileComponent + languageComponent;

	// Determine dominant signal for reason
	const signals = [
		{ name: 'task type', value: taskComponent },
		{ name: 'diff size', value: sizeComponent },
		{ name: 'profile', value: profileComponent },
		{ name: 'language', value: languageComponent },
	];
	const dominant = signals.reduce((a, b) => (a.value > b.value ? a : b));

	let reason = 'Recommended model';
	const sizeLabel = bucket === 'small' ? 'small' : bucket === 'medium' ? 'medium' : 'large';
	const taskLabel = input.taskType === 'review' ? 'reviews' : input.taskType === 'commit-message' ? 'commit messages' : input.taskType + 's';

	if (dominant.name === 'task type') {
		reason = `Best for ${taskLabel}`;
	} else if (dominant.name === 'diff size') {
		reason = `Optimized for ${sizeLabel} diffs`;
	} else if (dominant.name === 'profile') {
		reason = `Strong match for ${input.activeProfile ?? 'general'} profile`;
	} else if (dominant.name === 'language') {
		reason = `Strong for ${input.languages.slice(0, 2).join(', ')}`;
	}

	return { score: Math.min(finalScore, 1.0), reason };
}

/** Map a command ID to a TaskType */
export function commandToTaskType(commandId: string): TaskType {
	const map: Record<string, TaskType> = {
		'ollama-code-review.reviewChanges': 'review',
		'ollama-code-review.reviewCommit': 'review',
		'ollama-code-review.reviewCommitRange': 'review',
		'ollama-code-review.reviewChangesBetweenTwoBranches': 'review',
		'ollama-code-review.generateCommitMessage': 'commit-message',
		'ollama-code-review.explainCode': 'explain',
		'ollama-code-review.generateTests': 'generate-tests',
		'ollama-code-review.fixIssue': 'fix',
		'ollama-code-review.fixSelection': 'fix',
		'ollama-code-review.fixFinding': 'fix',
		'ollama-code-review.addDocumentation': 'document',
		'ollama-code-review.generateDiagram': 'diagram',
		'ollama-code-review.agentReview': 'agent-review',
		'ollama-code-review.suggestVersionBump': 'version-bump',
		'ollama-code-review.reviewFile': 'file-review',
		'ollama-code-review.reviewFolder': 'file-review',
		'ollama-code-review.reviewSelection': 'file-review',
	};
	return map[commandId] ?? 'review';
}

/** Extract file extensions from a unified diff */
export function extractLanguagesFromDiff(diff: string): string[] {
	const filePattern = /^(?:diff --git a\/.*?\.(\w+)|[-+]{3} [ab]\/.*?\.(\w+))/gm;
	const exts = new Set<string>();
	let match: RegExpExecArray | null;
	// eslint-disable-next-line no-cond-assign
	while ((match = filePattern.exec(diff)) !== null) {
		const ext = match[1] || match[2];
		if (ext) {
			exts.add(ext.toLowerCase());
		}
	}
	return [...exts];
}

async function fetchOllamaModels(endpoint: string): Promise<Array<{ name: string }>> {
	try {
		const baseUrl = endpoint.replace(/\/api\/generate\/?$/, '').replace(/\/$/, '');
		const response = await axios.get<{ models?: Array<{ name: string }> }>(`${baseUrl}/api/tags`, { timeout: 3000 });
		return response.data.models ?? [];
	} catch {
		return [];
	}
}

/**
 * Get model recommendation for the given input.
 * Scores all available models, filters by API key availability, and returns ranked suggestions.
 */
export async function getModelRecommendation(
	input: ModelAdvisorInput,
	config: vscode.WorkspaceConfiguration,
): Promise<ModelAdvisorResult> {
	const autoSelect = config.get<boolean>('autoSelectModel', false);

	// Build candidate list from cloud models
	const candidates: ScoredModel[] = [];

	for (const profile of MODEL_PROFILES) {
		// Check API key availability
		let available = true;
		if (profile.providerName === 'claude') {
			available = !!(config.get<string>('claudeApiKey') || process.env.ANTHROPIC_API_KEY);
		} else if (profile.providerName === 'glm') {
			available = !!(config.get<string>('glmApiKey') || process.env.GLM_API_KEY);
		} else if (profile.providerName === 'huggingface') {
			available = !!(config.get<string>('hfApiKey') || process.env.HF_API_KEY);
		} else if (profile.providerName === 'gemini') {
			available = !!(config.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY);
		} else if (profile.providerName === 'mistral') {
			available = !!(config.get<string>('mistralApiKey') || process.env.MISTRAL_API_KEY);
		} else if (profile.providerName === 'minimax') {
			available = !!(config.get<string>('minimaxApiKey') || process.env.MINIMAX_API_KEY);
		} else if (profile.providerName === 'openai-compatible') {
			available = !!(config.get<string>('openaiCompatible.endpoint') && config.get<string>('openaiCompatible.model'));
		} else if (profile.providerName === 'kimi' || profile.providerName === 'qwen') {
			// Cloud models, always available
			available = true;
		}

		if (!available) continue;

		const { score, reason } = scoreModel(profile, input);
		candidates.push({ ...profile, score, reason });
	}

	// Add Ollama models if endpoint available
	try {
		const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
		const ollamaModels = await fetchOllamaModels(endpoint);
		for (const model of ollamaModels) {
			const tier = classifyOllamaModel(model.name);
			const profile: ModelProfile = {
				modelId: model.name,
				providerName: 'ollama',
				tier,
			};
			const { score, reason } = scoreModel(profile, input);
			candidates.push({ ...profile, score, reason });
		}
	} catch {
		// Ollama not available, skip
	}

	// Sort by score descending
	candidates.sort((a, b) => b.score - a.score);

	// Return top + alternatives (max 5)
	const recommended = candidates[0] || {
		modelId: 'kimi-k2.5:cloud',
		providerName: 'kimi',
		tier: 'balanced' as const,
		score: 0.5,
		reason: 'Default recommendation',
	};

	const alternatives = candidates
		.slice(1, 5)
		.map(
			(c): ModelSuggestion => ({
				modelId: c.modelId,
				providerName: c.providerName,
				reason: c.reason,
				score: c.score,
				tier: c.tier,
			}),
		);

	return {
		recommended: {
			modelId: recommended.modelId,
			providerName: recommended.providerName,
			reason: recommended.reason,
			score: recommended.score,
			tier: recommended.tier,
		},
		alternatives,
		autoSelect,
	};
}
