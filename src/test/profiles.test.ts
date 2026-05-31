/**
 * Unit tests for src/profiles.ts
 *
 * Covers: BUILTIN_PROFILES structure, buildProfilePromptContext
 */

import * as assert from 'assert';
import { BUILTIN_PROFILES, buildProfilePromptContext } from '../profiles';
import type { ReviewProfile } from '../profiles';

suite('Profiles Test Suite', () => {

	// ─── BUILTIN_PROFILES ────────────────────────────────────────────────────

	suite('BUILTIN_PROFILES', () => {
		test('is a non-empty array', () => {
			assert.ok(Array.isArray(BUILTIN_PROFILES));
			assert.ok(BUILTIN_PROFILES.length > 0);
		});

		test('includes general profile', () => {
			const general = BUILTIN_PROFILES.find(p => p.name === 'general');
			assert.ok(general);
			assert.strictEqual(general!.severity, 'balanced');
			assert.strictEqual(general!.includeExplanations, true);
		});

		test('includes security profile', () => {
			const security = BUILTIN_PROFILES.find(p => p.name === 'security');
			assert.ok(security);
			assert.ok(security!.focusAreas.length > 0);
		});

		test('includes performance profile', () => {
			const perf = BUILTIN_PROFILES.find(p => p.name === 'performance');
			assert.ok(perf);
			assert.ok(perf!.focusAreas.length > 0);
		});

		test('all profiles have required fields', () => {
			for (const profile of BUILTIN_PROFILES) {
				assert.ok(profile.name, `Profile missing name`);
				assert.ok(profile.description, `${profile.name} missing description`);
				assert.ok(Array.isArray(profile.focusAreas), `${profile.name} focusAreas not an array`);
				assert.ok(profile.focusAreas.length > 0, `${profile.name} has no focus areas`);
				assert.ok(['lenient', 'balanced', 'strict'].includes(profile.severity), `${profile.name} has invalid severity: ${profile.severity}`);
				assert.strictEqual(typeof profile.includeExplanations, 'boolean', `${profile.name} includeExplanations not boolean`);
			}
		});

		test('profile names are unique', () => {
			const names = BUILTIN_PROFILES.map(p => p.name);
			const unique = new Set(names);
			assert.strictEqual(names.length, unique.size, 'Duplicate profile names found');
		});
	});

	// ─── buildProfilePromptContext ───────────────────────────────────────────

	suite('buildProfilePromptContext', () => {
		test('returns empty string for general profile', () => {
			const general = BUILTIN_PROFILES.find(p => p.name === 'general')!;
			const result = buildProfilePromptContext(general);
			assert.strictEqual(result, '');
		});

		test('includes profile name for non-general profiles', () => {
			const security = BUILTIN_PROFILES.find(p => p.name === 'security')!;
			const result = buildProfilePromptContext(security);
			assert.ok(result.includes('security'));
		});

		test('includes focus areas', () => {
			const security = BUILTIN_PROFILES.find(p => p.name === 'security')!;
			const result = buildProfilePromptContext(security);
			for (const area of security.focusAreas) {
				assert.ok(result.includes(area), `Missing focus area: ${area}`);
			}
		});

		test('includes severity instructions for strict', () => {
			const strictProfile: ReviewProfile = {
				name: 'strict-test',
				description: 'A strict test profile',
				focusAreas: ['Everything'],
				severity: 'strict',
				includeExplanations: false,
			};
			const result = buildProfilePromptContext(strictProfile);
			assert.ok(result.includes('Flag every issue'));
		});

		test('includes severity instructions for lenient', () => {
			const lenientProfile: ReviewProfile = {
				name: 'lenient-test',
				description: 'A lenient test profile',
				focusAreas: ['Major issues only'],
				severity: 'lenient',
				includeExplanations: true,
			};
			const result = buildProfilePromptContext(lenientProfile);
			assert.ok(result.includes('encouraging'));
		});

		test('includes severity instructions for balanced', () => {
			const balancedProfile: ReviewProfile = {
				name: 'balanced-test',
				description: 'A balanced test profile',
				focusAreas: ['General'],
				severity: 'balanced',
				includeExplanations: true,
			};
			const result = buildProfilePromptContext(balancedProfile);
			assert.ok(result.includes('Flag important issues'));
		});

		test('includes explanation level for includeExplanations=true', () => {
			const profile: ReviewProfile = {
				name: 'explanations-on',
				description: 'Test',
				focusAreas: ['Bugs'],
				severity: 'balanced',
				includeExplanations: true,
			};
			const result = buildProfilePromptContext(profile);
			assert.ok(result.includes('detailed explanations'));
		});

		test('includes concise instruction for includeExplanations=false', () => {
			const profile: ReviewProfile = {
				name: 'explanations-off',
				description: 'Test',
				focusAreas: ['Bugs'],
				severity: 'balanced',
				includeExplanations: false,
			};
			const result = buildProfilePromptContext(profile);
			assert.ok(result.includes('concise') || result.includes('Be concise'));
		});

		test('includes complianceContext when present', () => {
			const profile: ReviewProfile = {
				name: 'compliance-test',
				description: 'Compliance',
				focusAreas: ['OWASP Top 10'],
				severity: 'strict',
				includeExplanations: true,
				complianceContext: 'This review must check for OWASP compliance.',
			};
			const result = buildProfilePromptContext(profile);
			assert.ok(result.includes('OWASP compliance'));
		});

		test('includes description', () => {
			const profile: ReviewProfile = {
				name: 'desc-test',
				description: 'Finds all the bugs',
				focusAreas: ['Bugs'],
				severity: 'balanced',
				includeExplanations: true,
			};
			const result = buildProfilePromptContext(profile);
			assert.ok(result.includes('Finds all the bugs'));
		});
	});
});
