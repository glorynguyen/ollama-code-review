import * as assert from 'assert';
import {
	buildDependencyRiskPromptContext,
	extractDependencyChanges,
	renderDependencyRiskMarkdown,
	reviewDependencyRisks,
	type DependencyChange,
} from '../dependencyReview';

suite('Dependency Risk Review Test Suite', () => {
	test('extracts exact npm dependencies with their added-line anchors', () => {
		const changes = extractDependencyChanges([
			'diff --git a/package.json b/package.json',
			'--- a/package.json',
			'+++ b/package.json',
			'@@ -3,3 +3,4 @@',
			'   "dependencies": {',
			'+    "lodash": "4.17.21",',
			'     "zod": "3.0.0"',
			'   }',
		].join('\n'));

		assert.deepStrictEqual(changes, [{
			name: 'lodash', version: '4.17.21', ecosystem: 'npm', file: 'package.json', line: 4, group: 'dependencies',
		}]);
	});

	test('extracts scoped npm and exact PyPI requirements, but skips ranges', () => {
		const changes = extractDependencyChanges([
			'diff --git a/package.json b/package.json',
			'+++ b/package.json',
			'@@ -1,2 +1,4 @@',
			'+  "devDependencies": {',
			'+    "@scope/tool": "1.2.3",',
			'+    "unresolved": "^2.0.0"',
			'+  }',
			'diff --git a/requirements.txt b/requirements.txt',
			'+++ b/requirements.txt',
			'@@ -0,0 +1,3 @@',
			'+requests==2.32.3',
			'+flask>=3.0.0',
			'+# comment',
		].join('\n'));

		assert.deepStrictEqual(changes.map(({ name, version, ecosystem }) => ({ name, version, ecosystem })), [
			{ name: '@scope/tool', version: '1.2.3', ecosystem: 'npm' },
			{ name: 'requests', version: '2.32.3', ecosystem: 'PyPI' },
		]);
	});

	test('finds package dependencies when the git hunk omits the object header', () => {
		const changes = extractDependencyChanges([
			'+++ b/package.json',
			'@@ -62,3 +62,3 @@',
			'     "existing": "1.0.0",',
			'-    "upgraded": "1.0.0",',
			'+    "upgraded": "2.0.0",',
			'     "another": "1.0.0"',
		].join('\n'));

		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].name, 'upgraded');
		assert.strictEqual(changes[0].version, '2.0.0');
	});

	test('deduplicates identical changes returned by multiple hunks', () => {
		const changes = extractDependencyChanges([
			'+++ b/package.json',
			'@@ -1,1 +1,2 @@',
			'+  "lodash": "4.17.21",',

			'@@ -20,1 +20,2 @@',
			'+  "lodash": "4.17.21",',
		].join('\n'));
		assert.strictEqual(changes.length, 1);
		assert.strictEqual(changes[0].name, 'lodash');
		assert.strictEqual(changes[0].version, '4.17.21');
	});

	test('extracts exact Gemfile and go.mod dependencies', () => {
		const changes = extractDependencyChanges([
			'+++ b/Gemfile',
			'@@ -1,1 +1,2 @@',
			'+gem "rails", "7.1.3"',
			'+++ b/go.mod',
			'@@ -2,1 +2,2 @@',
			'+github.com/example/module v1.2.3',
		].join('\n'));

		assert.deepStrictEqual(changes.map(({ name, ecosystem }) => ({ name, ecosystem })), [
			{ name: 'rails', ecosystem: 'RubyGems' },
			{ name: 'github.com/example/module', ecosystem: 'Go' },
		]);
	});

	test('maps OSV vulnerabilities to high-confidence structured findings', async () => {
		const diff = [
			'+++ b/package.json',
			'@@ -1,1 +1,3 @@',
			'+"dependencies": {',
			'+  "vulnerable-package": "1.0.0"',
			'+}',
		].join('\n');
		const queried: DependencyChange[] = [];
		const result = await reviewDependencyRisks(diff, {}, async (dependency) => {
			queried.push(dependency);
			return { vulns: [{ id: 'GHSA-test', summary: 'Test vulnerability', database_specific: { severity: 'HIGH' } }] };
		});

		assert.strictEqual(queried.length, 1);
		assert.strictEqual(result.checkedCount, 1);
		assert.strictEqual(result.failures, 0);
		assert.strictEqual(result.findings[0].severity, 'high');
		assert.strictEqual(result.findings[0].anchor?.line, 2);
		assert.ok(result.findings[0].summary.includes('GHSA-test'));
		assert.ok(renderDependencyRiskMarkdown(result.findings).includes('Dependency Risk'));
		assert.ok(buildDependencyRiskPromptContext(result.findings).includes('verified context'));
	});

	test('continues when OSV is unavailable and obeys the dependency limit', async () => {
		const diff = [
			'+++ b/requirements.txt',
			'@@ -0,0 +1,2 @@',
			'+first==1.0.0',
			'+second==1.0.0',
		].join('\n');
		let calls = 0;
		const result = await reviewDependencyRisks(diff, { maxDependencies: 1 }, async () => {
			calls++;
			throw new Error('offline');
		});

		assert.strictEqual(calls, 1);
		assert.strictEqual(result.checkedCount, 0);
		assert.strictEqual(result.failures, 1);
		assert.strictEqual(result.findings.length, 0);
	});
});
