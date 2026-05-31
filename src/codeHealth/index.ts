/**
 * F-050: Code Health Regression Guard
 *
 * Barrel exports for the codeHealth module.
 */

export { CodeHealthTreeProvider } from './healthTreeProvider';
export {
	getCodeHealthConfig,
	buildFileHealthMap,
	computeFileHealthSummary,
	getHealthSummaries,
	getHotspots,
	detectRegressions,
	formatRegressionWarning,
	notifyRegressions,
	shouldBlockCommit,
} from './tracker';
export type {
	CodeHealthConfig,
	FileHealthEntry,
	FileHealthSummary,
	FileRegression,
	RegressionResult,
} from './types';
