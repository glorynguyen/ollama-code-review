/**
 * F-037: Model Advisor unit tests
 * Verify the 4-signal heuristic scoring logic with the dry-run example.
 */

import * as assert from 'assert';
import { bucketDiffSize, scoreModel, commandToTaskType, extractLanguagesFromDiff } from '../modelAdvisor';
import type { ModelAdvisorInput, ModelProfile } from '../modelAdvisor/types';
import { classifyOllamaModel } from '../modelAdvisor/profiles';

suite('Model Advisor Tests', () => {
	suite('bucketDiffSize', () => {
		test('small diff: 1999 chars', () => {
			assert.strictEqual(bucketDiffSize(1999), 'small');
		});

		test('small-to-medium boundary: 2000 chars', () => {
			assert.strictEqual(bucketDiffSize(2000), 'medium');
		});

		test('medium diff: 10000 chars', () => {
			assert.strictEqual(bucketDiffSize(10000), 'medium');
		});

		test('medium-to-large boundary: 20000 chars', () => {
			assert.strictEqual(bucketDiffSize(20000), 'large');
		});

		test('large diff: 50000 chars', () => {
			assert.strictEqual(bucketDiffSize(50000), 'large');
		});
	});

	suite('classifyOllamaModel', () => {
		test('coder model → code-specialist', () => {
			assert.strictEqual(classifyOllamaModel('qwen2.5-coder:14b-instruct-q4_0'), 'code-specialist');
		});

		test('70b model → flagship', () => {
			assert.strictEqual(classifyOllamaModel('llama3:70b'), 'flagship');
		});

		test('405b model → flagship', () => {
			assert.strictEqual(classifyOllamaModel('qwen2-72b-instruct:405b'), 'flagship');
		});

		test('small model → local', () => {
			assert.strictEqual(classifyOllamaModel('phi3:mini'), 'local');
		});

		test('dolphin model → flagship', () => {
			assert.strictEqual(classifyOllamaModel('dolphin-mixtral:latest'), 'flagship');
		});
	});

	suite('scoreModel — 4-signal heuristic', () => {
		test('Claude Opus for security review of medium TS diff → ~0.81', () => {
			const profile: ModelProfile = {
				modelId: 'claude-opus-4-20250514',
				providerName: 'claude',
				tier: 'flagship',
				languageBonus: { ts: 0.2, tsx: 0.2, js: 0.1, jsx: 0.1 },
			};

			const input: ModelAdvisorInput = {
				taskType: 'review',
				languages: ['ts', 'tsx'],
				contentLength: 8500,
				activeProfile: 'security',
			};

			const { score, reason } = scoreModel(profile, input);

			// Expected calculation (weights: task=0.35, size=0.25, profile=0.20, language=0.20):
			// Task: flagship@review=0.9 → 0.35*0.9=0.315
			// Size: flagship@medium=0.7 → 0.25*0.7=0.175
			// Profile: flagship@security=1.0 → 0.20*1.0=0.200
			// Language: max bonus 0.2 → score=min(0.5+0.2,1.0)=0.7 → 0.20*0.7=0.140
			// Total = 0.315+0.175+0.200+0.140 = 0.830
			assert.ok(score >= 0.80 && score <= 0.84, `Expected ~0.81–0.83, got ${score}`);
			assert.ok(reason.length > 0);
		});

		test('Codestral for security review of medium TS diff → ~0.605', () => {
			const profile: ModelProfile = {
				modelId: 'codestral-latest',
				providerName: 'mistral',
				tier: 'code-specialist',
				languageBonus: { ts: 0.3, js: 0.3, py: 0.2 },
			};

			const input: ModelAdvisorInput = {
				taskType: 'review',
				languages: ['ts', 'tsx'],
				contentLength: 8500,
				activeProfile: 'security',
			};

			const { score } = scoreModel(profile, input);

			// Task: code-specialist@review=0.6 → 0.35*0.6=0.210
			// Size: code-specialist@medium=0.7 → 0.25*0.7=0.175
			// Profile: code-specialist@security=0.4 → 0.20*0.4=0.080
			// Language: max bonus 0.3 → score=min(0.5+0.3,1.0)=0.8 → 0.20*0.8=0.160
			// Total = 0.210+0.175+0.080+0.160 = 0.625
			assert.ok(score >= 0.60 && score <= 0.65, `Expected ~0.61–0.63, got ${score}`);
		});

		test('Gemini Flash for security review of medium TS diff → ~0.43', () => {
			const profile: ModelProfile = {
				modelId: 'gemini-2.5-flash',
				providerName: 'gemini',
				tier: 'fast',
			};

			const input: ModelAdvisorInput = {
				taskType: 'review',
				languages: ['ts', 'tsx'],
				contentLength: 8500,
				activeProfile: 'security',
			};

			const { score } = scoreModel(profile, input);

			// Task: fast@review=0.4 → 0.35*0.4=0.140
			// Size: fast@medium=0.6 → 0.25*0.6=0.150
			// Profile: fast@security=0.2 → 0.20*0.2=0.040
			// Language: no bonus → score=0.5 → 0.20*0.5=0.100
			// Total = 0.140+0.150+0.040+0.100 = 0.430
			assert.ok(score >= 0.42 && score <= 0.44, `Expected ~0.43, got ${score}`);
		});

		test('Large diff (flagship model) scores higher than small diff', () => {
			const profile: ModelProfile = {
				modelId: 'claude-opus-4-20250514',
				providerName: 'claude',
				tier: 'flagship',
			};

			const smallInput: ModelAdvisorInput = {
				taskType: 'review',
				languages: ['ts'],
				contentLength: 500,
				activeProfile: 'general',
			};

			const largeInput: ModelAdvisorInput = {
				taskType: 'review',
				languages: ['ts'],
				contentLength: 50000,
				activeProfile: 'general',
			};

			const smallScore = scoreModel(profile, smallInput).score;
			const largeScore = scoreModel(profile, largeInput).score;

			assert.ok(largeScore > smallScore, `Large diff (${largeScore}) should score higher than small (${smallScore}) for flagship`);
		});
	});

	suite('commandToTaskType', () => {
		test('reviewChanges → review', () => {
			assert.strictEqual(commandToTaskType('ollama-code-review.reviewChanges'), 'review');
		});

		test('generateCommitMessage → commit-message', () => {
			assert.strictEqual(commandToTaskType('ollama-code-review.generateCommitMessage'), 'commit-message');
		});

		test('generateTests → generate-tests', () => {
			assert.strictEqual(commandToTaskType('ollama-code-review.generateTests'), 'generate-tests');
		});

		test('fixFinding → fix', () => {
			assert.strictEqual(commandToTaskType('ollama-code-review.fixFinding'), 'fix');
		});

		test('unknown command → review (default)', () => {
			assert.strictEqual(commandToTaskType('unknown.command'), 'review');
		});
	});

	suite('extractLanguagesFromDiff', () => {
		test('single TypeScript file', () => {
			const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
 const x = 1;`;
			const langs = extractLanguagesFromDiff(diff);
			assert.ok(langs.includes('ts'));
		});

		test('multiple files with different extensions', () => {
			const diff = `diff --git a/src/app.tsx b/src/app.tsx
--- a/src/app.tsx
+++ b/src/app.tsx
@@ -1 @@

diff --git a/config.py b/config.py
--- a/config.py
+++ b/config.py
@@ -1 @@`;
			const langs = extractLanguagesFromDiff(diff);
			assert.ok(langs.includes('tsx'));
			assert.ok(langs.includes('py'));
		});

		test('empty diff → empty languages', () => {
			const langs = extractLanguagesFromDiff('');
			assert.strictEqual(langs.length, 0);
		});

		test('normalized to lowercase', () => {
			const diff = `diff --git a/test.TS b/test.TS
--- a/test.TS
+++ b/test.TS`;
			const langs = extractLanguagesFromDiff(diff);
			assert.ok(langs.includes('ts'), 'Should normalize TS to ts');
		});
	});
});
