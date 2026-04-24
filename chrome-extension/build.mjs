import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const watch = process.argv.includes('--watch');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const common = {
	bundle: true,
	format: 'esm',
	target: 'chrome120',
	sourcemap: true,
	logLevel: 'info',
	platform: 'browser',
	absWorkingDir: scriptDir,
	tsconfig: path.join(scriptDir, 'tsconfig.json'),
};

const builds = [
	{
		entryPoints: [path.join(scriptDir, 'src/background.ts')],
		outfile: path.join(scriptDir, 'dist/background.js'),
		...common,
	},
	{
		entryPoints: [path.join(scriptDir, 'src/content.ts')],
		outfile: path.join(scriptDir, 'dist/content.js'),
		...common,
	},
	{
		entryPoints: [path.join(scriptDir, 'src/overlay.ts')],
		outfile: path.join(scriptDir, 'dist/overlay.js'),
		...common,
	},
	{
		entryPoints: [path.join(scriptDir, 'src/claudeUsage.ts')],
		outfile: path.join(scriptDir, 'dist/claudeUsage.js'),
		...common,
	},
	{
		entryPoints: [path.join(scriptDir, 'src/copilotUsage.ts')],
		outfile: path.join(scriptDir, 'dist/copilotUsage.js'),
		...common,
	},
];

if (watch) {
	for (const config of builds) {
		const ctx = await esbuild.context(config);
		await ctx.watch();
	}
	console.log('Watching Chrome extension sources...');
} else {
	await Promise.all(builds.map(config => esbuild.build(config)));
}
