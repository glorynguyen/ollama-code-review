/**
 * Unit tests for src/knowledge/matcher.ts
 *
 * Covers: matchKnowledge (decisions, patterns, rules; scoring, sorting, maxResults)
 */

import * as assert from 'assert';
import { matchKnowledge } from '../knowledge/matcher';
import type { KnowledgeYamlConfig, KnowledgeDecision, KnowledgePattern } from '../knowledge/types';

function makeKnowledge(overrides: Partial<KnowledgeYamlConfig> = {}): KnowledgeYamlConfig {
	return {
		decisions: [],
		patterns: [],
		rules: [],
		...overrides,
	};
}

suite('Knowledge Matcher Test Suite', () => {

	suite('matchKnowledge', () => {

		test('returns empty matches for empty knowledge base', () => {
			const result = matchKnowledge(makeKnowledge(), 'any content here');
			assert.strictEqual(result.matches.length, 0);
			assert.strictEqual(result.totalEntries, 0);
		});

		test('matches decisions by keyword overlap', () => {
			const decisions: KnowledgeDecision[] = [
				{
					id: 'ADR-001',
					title: 'Use Redux for state management',
					decision: 'All global state must be managed through Redux store',
					tags: ['state', 'redux', 'react'],
				},
			];
			const knowledge = makeKnowledge({ decisions });
			const result = matchKnowledge(knowledge, 'import { useSelector } from "redux"; const state = store.getState();');
			assert.ok(result.matches.length > 0);
			assert.strictEqual(result.matches[0].type, 'decision');
			assert.ok(result.matches[0].relevance > 0);
		});

		test('matches patterns by keyword overlap', () => {
			const patterns: KnowledgePattern[] = [
				{
					id: 'PAT-001',
					name: 'API error handling',
					description: 'Standard try/catch with toast notification for API calls',
					tags: ['error-handling', 'api', 'toast'],
				},
			];
			const knowledge = makeKnowledge({ patterns });
			const result = matchKnowledge(knowledge, 'try { const data = await api.fetch("/endpoint"); } catch (error) { toast.error(error); }');
			assert.ok(result.matches.length > 0);
			assert.strictEqual(result.matches[0].type, 'pattern');
			assert.ok(result.matches[0].relevance > 0);
		});

		test('rules always get fixed relevance of 0.5', () => {
			const rules = ['Always use TypeScript strict mode', 'Prefer named exports over default exports'];
			const knowledge = makeKnowledge({ rules });
			const result = matchKnowledge(knowledge, 'export default function foo() {}');
			assert.strictEqual(result.matches.length, 2);
			for (const match of result.matches) {
				assert.strictEqual(match.type, 'rule');
				assert.strictEqual(match.relevance, 0.5);
			}
		});

		test('sorts matches by relevance descending', () => {
			const decisions: KnowledgeDecision[] = [
				{
					id: 'ADR-001',
					title: 'Use React hooks',
					decision: 'Prefer functional components with hooks over class components',
					tags: ['react', 'hooks'],
				},
				{
					id: 'ADR-002',
					title: 'Database ORM',
					decision: 'Use Prisma as the database ORM layer for all database access',
					tags: ['database', 'prisma', 'orm'],
				},
			];
			const knowledge = makeKnowledge({ decisions });
			// Content highly relevant to ADR-001, not ADR-002
			const result = matchKnowledge(knowledge, 'import { useState, useEffect } from "react"; function MyComponent() { const [state, setState] = useState(null); }');
			if (result.matches.length >= 2) {
				assert.ok(result.matches[0].relevance >= result.matches[1].relevance);
			}
		});

		test('respects maxResults cap', () => {
			const rules = [
				'Rule 1', 'Rule 2', 'Rule 3', 'Rule 4', 'Rule 5',
				'Rule 6', 'Rule 7', 'Rule 8', 'Rule 9', 'Rule 10', 'Rule 11',
			];
			const knowledge = makeKnowledge({ rules });
			const result = matchKnowledge(knowledge, 'any content', 3);
			assert.strictEqual(result.matches.length, 3);
		});

		test('default maxResults is 10', () => {
			const rules = Array.from({ length: 15 }, (_, i) => `Rule ${i + 1}`);
			const knowledge = makeKnowledge({ rules });
			const result = matchKnowledge(knowledge, 'any content');
			assert.strictEqual(result.matches.length, 10);
		});

		test('totalEntries counts all entries regardless of maxResults', () => {
			const rules = Array.from({ length: 15 }, (_, i) => `Rule ${i + 1}`);
			const knowledge = makeKnowledge({ rules });
			const result = matchKnowledge(knowledge, 'any content', 3);
			assert.strictEqual(result.totalEntries, 15);
		});

		test('handles decisions without tags', () => {
			const decisions: KnowledgeDecision[] = [
				{
					id: 'ADR-001',
					title: 'Use TypeScript',
					decision: 'The project uses TypeScript for type safety',
				},
			];
			const knowledge = makeKnowledge({ decisions });
			const result = matchKnowledge(knowledge, 'const x: string = "hello"; interface Foo { bar: number; }');
			assert.strictEqual(result.totalEntries, 1);
		});

		test('handles patterns with example content', () => {
			const patterns: KnowledgePattern[] = [
				{
					id: 'PAT-001',
					name: 'Logger usage',
					description: 'Use the shared logger for all logging',
					example: 'import { logger } from "./logger"; logger.info("message");',
					tags: ['logging'],
				},
			];
			const knowledge = makeKnowledge({ patterns });
			const result = matchKnowledge(knowledge, 'import { logger } from "./logger"; logger.info("starting");');
			assert.ok(result.matches.length > 0);
			assert.strictEqual(result.matches[0].type, 'pattern');
		});

		test('filters out zero-relevance entries (except rules)', () => {
			const decisions: KnowledgeDecision[] = [
				{
					id: 'ADR-001',
					title: 'Use specific database technology',
					decision: 'All data storage must use PostgreSQL with Prisma ORM',
					tags: ['database', 'postgresql', 'prisma'],
				},
			];
			const knowledge = makeKnowledge({ decisions });
			// Content completely unrelated to database
			const result = matchKnowledge(knowledge, 'body { margin: 0; padding: 0; } .container { display: flex; }');
			// If no keyword overlap, decision should have 0 relevance and be filtered
			const decisionMatches = result.matches.filter(m => m.type === 'decision');
			for (const m of decisionMatches) {
				assert.ok(m.relevance > 0);
			}
		});

		test('mixed knowledge types are all included', () => {
			const knowledge = makeKnowledge({
				decisions: [{ id: 'ADR-001', title: 'Use React', decision: 'React for all UI components', tags: ['react'] }],
				patterns: [{ id: 'PAT-001', name: 'Component pattern', description: 'React functional component with hooks', tags: ['react', 'hooks'] }],
				rules: ['Use TypeScript strict mode'],
			});
			const result = matchKnowledge(knowledge, 'import React from "react"; function App() { return <div />; }');
			const types = new Set(result.matches.map(m => m.type));
			assert.ok(types.has('rule'));
			// Decisions or patterns should also appear if keywords match
			assert.ok(result.totalEntries === 3);
		});
	});
});
