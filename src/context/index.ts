/**
 * F-008: Multi-File Contextual Analysis — Barrel Exports
 */

export type {
	ContextGatheringConfig,
	ContextBundle,
	ContextFile,
	ContextFileReason,
	ContextGatheringStats,
	ParsedImport,
} from './types';

export {
	gatherContext,
	formatContextForPrompt,
	getContextGatheringConfig,
	DEFAULT_CONTEXT_CONFIG,
} from './contextGatherer';

export { parseImports, extractChangedFiles } from './importParser';
export { resolveImport, readFileContent, toRelativePath } from './fileResolver';
export { findTestFiles } from './testDiscovery';
