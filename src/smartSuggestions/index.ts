/**
 * F-049: Smart Review Suggestions — Barrel Exports
 */
export {
	generateSmartSuggestions,
	generateFixSuggestions,
	generateProfileSuggestions,
	generateTrendSuggestions,
	generateWorkflowSuggestions,
} from './analyzer';
export type {
	SmartSuggestion,
	SuggestionCategory,
	SuggestionInput,
	SuggestionPriority,
	SuggestionResult,
} from './types';
