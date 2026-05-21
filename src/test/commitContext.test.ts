import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
	extractCommitHashFromCommandArgs,
	extractRepositoryPathFromCommandArgs,
} from '../commands/commitContext';

suite('Commit context review integration', () => {
	test('extracts commit hashes from common SCM and GitLens payloads', () => {
		assert.strictEqual(
			extractCommitHashFromCommandArgs({ hash: 'a1b2c3d4e5f6' }),
			'a1b2c3d4e5f6',
		);
		assert.strictEqual(
			extractCommitHashFromCommandArgs('  1234567  '),
			'1234567',
		);
		assert.strictEqual(
			extractCommitHashFromCommandArgs({ commit: { sha: '0123456789abcdef0123456789abcdef01234567' } }),
			'0123456789abcdef0123456789abcdef01234567',
		);
		assert.strictEqual(
			extractCommitHashFromCommandArgs({
				webviewItem: 'gitlens:commit+current',
				webviewItemValue: {
					type: 'commit',
					ref: {
						ref: 'fedcba9876543210',
						repoPath: '/workspace/repo',
						refType: 'revision',
					},
				},
			}),
			'fedcba9876543210',
		);
	});

	test('extracts embedded commit hashes only from known commit-like payload fields', () => {
		assert.strictEqual(
			extractCommitHashFromCommandArgs({ hash: 'GitLens commit abc123456789 is selected' }),
			'abc123456789',
		);
		assert.strictEqual(
			extractCommitHashFromCommandArgs('GitLens commit abc123456789 is selected'),
			undefined,
		);
		assert.strictEqual(
			extractCommitHashFromCommandArgs({ hash: 'commit is not available' }),
			undefined,
		);
	});

	test('ignores unsupported commit hash payload shapes safely', () => {
		const circularPayload: Record<string, unknown> = {};
		circularPayload.commit = circularPayload;

		assert.strictEqual(extractCommitHashFromCommandArgs(), undefined);
		assert.strictEqual(extractCommitHashFromCommandArgs(null, 42, false), undefined);
		assert.strictEqual(extractCommitHashFromCommandArgs({ commit: 42 }, { id: 'not-a-sha' }), undefined);
		assert.strictEqual(extractCommitHashFromCommandArgs(circularPayload), undefined);
	});

	test('continues commit hash extraction when known properties throw', () => {
		const payload: Record<string, unknown> = {
			sha: 'beadfeed1234',
		};
		Object.defineProperty(payload, 'hash', {
			enumerable: true,
			get() {
				throw new Error('hash getter should be ignored');
			},
		});

		assert.strictEqual(extractCommitHashFromCommandArgs(payload), 'beadfeed1234');
	});

	test('extracts repository paths from SCM and GitLens payloads', () => {
		assert.strictEqual(
			extractRepositoryPathFromCommandArgs({ repoRoot: '/workspace/repo' }),
			'/workspace/repo',
		);
		assert.strictEqual(
			extractRepositoryPathFromCommandArgs({ repository: { rootUri: { fsPath: '/workspace/nested' } } }),
			'/workspace/nested',
		);
		assert.strictEqual(
			extractRepositoryPathFromCommandArgs({
				webviewItemValue: {
					type: 'commit',
					ref: {
						ref: 'fedcba9876543210',
						repoPath: '/workspace/graph',
						refType: 'revision',
					},
				},
			}),
			'/workspace/graph',
		);
	});

	test('ignores unsupported repository path payload shapes safely', () => {
		const circularPayload: Record<string, unknown> = {};
		circularPayload.repository = circularPayload;

		assert.strictEqual(extractRepositoryPathFromCommandArgs(), undefined);
		assert.strictEqual(extractRepositoryPathFromCommandArgs(null, 'repo', 42), undefined);
		assert.strictEqual(
			extractRepositoryPathFromCommandArgs({ rootUri: { fsPath: 42 }, repoRoot: 42, repository: {} }),
			undefined,
		);
		assert.strictEqual(extractRepositoryPathFromCommandArgs(circularPayload), undefined);
	});

	test('continues repository path extraction when known properties throw', () => {
		const payload: Record<string, unknown> = {
			repositoryPath: '/workspace/fallback',
		};
		Object.defineProperty(payload, 'rootUri', {
			enumerable: true,
			get() {
				throw new Error('rootUri getter should be ignored');
			},
		});
		Object.defineProperty(payload, 'repoRoot', {
			enumerable: true,
			get() {
				throw new Error('repoRoot getter should be ignored');
			},
		});

		assert.strictEqual(extractRepositoryPathFromCommandArgs(payload), '/workspace/fallback');
	});

	test('does not enumerate arbitrary GitLens payload properties', () => {
		const gitLensPayload: Record<string, unknown> = {
			webviewItem: 'gitlens:commit+current',
			webviewItemValue: {
				type: 'commit',
				ref: {
					ref: 'abc123456789',
					repoPath: '/workspace/repo',
				},
			},
		};
		Object.defineProperty(gitLensPayload, 'runtime', {
			enumerable: true,
			get() {
				throw new Error('extensionRuntime proposal was accessed');
			},
		});

		assert.strictEqual(extractCommitHashFromCommandArgs(gitLensPayload), 'abc123456789');
		assert.strictEqual(extractRepositoryPathFromCommandArgs(gitLensPayload), '/workspace/repo');
	});

	test('contributes review commit actions to GitLens commit contexts', () => {
		const packageJsonPath = path.resolve(__dirname, '../../package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
			contributes?: {
				menus?: Record<string, Array<{ command?: string; when?: string }>>;
			};
		};

		const webviewMenus = packageJson.contributes?.menus?.['webview/context'] ?? [];
		assert.ok(webviewMenus.some(item =>
			item.command === 'ollama-code-review.reviewCommit' &&
			item.when?.includes('webviewItem =~ /gitlens:commit') &&
			item.when?.includes('gitlens.graph'),
		));

		const viewItemMenus = packageJson.contributes?.menus?.['view/item/context'] ?? [];
		assert.ok(viewItemMenus.some(item =>
			item.command === 'ollama-code-review.reviewCommit' &&
				item.when?.includes('viewItem =~ /gitlens:commit'),
		));
	});

});
