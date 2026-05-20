import * as assert from 'assert';
import {
	extractExports,
	getSignatureHash,
	hasSignificantSignatureChange,
} from '../context/signatureHeuristics';

suite('Signature Heuristics Test Suite', () => {
	test('extracts common exported signatures', () => {
		const exports = extractExports([
			'export { alpha, beta as renamed };',
			'export async function loadUser(id: string) { return id; }',
			'export const formatName = (name: string) => name.trim();',
			'export class ReviewPanel {}',
			'export interface ReviewConfig { enabled: boolean; }',
			'export type Severity = "low" | "high";',
			'export const timeoutMs: number = 1000;',
		].join('\n'));

		assert.deepStrictEqual(exports.map(item => [item.name, item.type]), [
			['alpha', 'block'],
			['beta as renamed', 'block'],
			['loadUser', 'function'],
			['formatName', 'function'],
			['ReviewPanel', 'class'],
			['ReviewConfig', 'type'],
			['Severity', 'type'],
			['timeoutMs', 'variable'],
		]);
	});

	test('hashes signatures deterministically despite export order', () => {
		const first = [
			'export const beta: number = 2;',
			'export function alpha(value: string) { return value; }',
		].join('\n');
		const second = [
			'export function alpha(value: string) { return value.toUpperCase(); }',
			'export const beta: number = 3;',
		].join('\n');

		assert.strictEqual(getSignatureHash(first), getSignatureHash(second));
	});

	test('detects public API additions and signature changes', () => {
		assert.strictEqual(
			hasSignificantSignatureChange(
				'export function parse(input: string) { return input; }',
				'export function parse(input: string, strict = false) { return input; }',
			),
			true,
		);

		assert.strictEqual(
			hasSignificantSignatureChange(
				'export const parse = (input: string) => input;',
				[
					'export const parse = (input: string) => input.trim();',
					'export class Parser {}',
				].join('\n'),
			),
			true,
		);
	});

	test('ignores implementation-only changes when signatures are stable', () => {
		assert.strictEqual(
			hasSignificantSignatureChange(
				'export function normalize(value: string) { return value.trim(); }',
				'export function normalize(value: string) { return value.trim().toLowerCase(); }',
			),
			false,
		);
	});
});
