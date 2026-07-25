import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: [
		'out/test/batchFix.test.js',
		'out/test/copySelectedFilesForLLM.test.js',
		'out/test/extension.test.js',
		'out/test/fileOperations.test.js',
		'out/test/reviewCache.test.js',
		'out/test/reviewCoverage.test.js',
		'out/test/ragStorage.integration.test.js',
		'out/test/testAction.test.js',
	],
	launchArgs: [process.cwd()],
	mocha: {
		timeout: 10000,
	},
});
