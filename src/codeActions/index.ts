/**
 * Code Actions module - Provides inline code action providers for VS Code
 * Part of F-005: Inline Code Actions feature
 */

// Types
export { parseCodeResponse, parseTestResponse, extractSymbolName, createVirtualUri } from './types';
export type { CodeActionResult, TestGenerationResult, DocumentationResult } from './types';

// Explain Code Action
export { ExplainCodeActionProvider, ExplainCodePanel } from './explainAction';

// Generate Tests Action
export {
	GenerateTestsActionProvider,
	GenerateTestsPanel,
	getTestFileName,
	detectTestFramework
} from './testAction';

// Fix Issue Action
export {
	FixIssueActionProvider,
	FixPreviewPanel,
	FixTracker
} from './fixAction';
export type { AppliedFix } from './fixAction';

// Add Documentation Action
export {
	AddDocumentationActionProvider,
	DocumentationPreviewPanel,
	getDocumentationStyle
} from './documentAction';
