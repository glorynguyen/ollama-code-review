import * as assert from 'assert';
import * as vscode from 'vscode';
import { pickBranch } from '../commands/uiHelpers';

function makeRepo(localNames: string[], remoteNames: string[], headName?: string) {
	return {
		getBranches({ remote }: { remote: boolean }) {
			const names = remote ? remoteNames : localNames;
			return Promise.resolve(names.map(name => ({ name })));
		},
		state: { HEAD: headName ? { name: headName } : undefined },
	};
}

suite('pickBranch', () => {
	let originalShowQuickPick: any;

	setup(() => {
		originalShowQuickPick = (vscode.window as any).showQuickPick;
	});

	teardown(() => {
		(vscode.window as any).showQuickPick = originalShowQuickPick;
	});

	test('lists local branches before remote-only branches', async () => {
		let capturedItems: vscode.QuickPickItem[] = [];
		(vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
			capturedItems = items;
			return items[0];
		};

		const repo = makeRepo(['main', 'dev'], ['main', 'origin/release']);
		await pickBranch(repo, { placeHolder: 'Pick' });

		const labels = capturedItems.map(i => i.description);
		const lastLocalIdx = labels.lastIndexOf('local');
		const firstRemoteIdx = labels.indexOf('remote');
		assert.ok(firstRemoteIdx > lastLocalIdx, 'remote branches should appear after local');
	});

	test('deduplicates branches that exist both locally and remotely', async () => {
		let capturedItems: vscode.QuickPickItem[] = [];
		(vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
			capturedItems = items;
			return items[0];
		};

		const repo = makeRepo(['main', 'dev'], ['main', 'dev', 'origin/staging']);
		await pickBranch(repo, { placeHolder: 'Pick' });

		const branchNames = capturedItems.map(i => i.label.replace(/^\$\(git-branch\)\s*/, ''));
		const unique = new Set(branchNames);
		assert.strictEqual(branchNames.length, unique.size, 'no duplicate branch names');
		assert.strictEqual(branchNames.length, 3); // dev, main, origin/staging
	});

	test('pins current branch to the top', async () => {
		let capturedItems: vscode.QuickPickItem[] = [];
		(vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
			capturedItems = items;
			return items[0];
		};

		const repo = makeRepo(['main', 'dev', 'feature-x'], []);
		await pickBranch(repo, { placeHolder: 'Pick', currentBranch: 'feature-x' });

		const first = capturedItems[0];
		assert.ok(first.label.includes('feature-x'));
		assert.strictEqual(first.description, 'current branch');
	});

	test('sorts branches alphabetically within groups', async () => {
		let capturedItems: vscode.QuickPickItem[] = [];
		(vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
			capturedItems = items;
			return items[0];
		};

		const repo = makeRepo(['zebra', 'alpha', 'middle'], []);
		await pickBranch(repo, { placeHolder: 'Pick' });

		const names = capturedItems.map(i => i.label.replace(/^\$\(git-branch\)\s*/, ''));
		assert.deepStrictEqual(names, ['alpha', 'middle', 'zebra']);
	});

	test('returns selected branch name without icon prefix', async () => {
		(vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
			return items.find(i => i.label.includes('dev'));
		};

		const repo = makeRepo(['main', 'dev'], []);
		const result = await pickBranch(repo, { placeHolder: 'Pick' });

		assert.strictEqual(result, 'dev');
	});

	test('returns undefined when user cancels', async () => {
		(vscode.window as any).showQuickPick = async () => undefined;

		const repo = makeRepo(['main'], []);
		const result = await pickBranch(repo, { placeHolder: 'Pick' });

		assert.strictEqual(result, undefined);
	});

	test('handles empty branch lists', async () => {
		let capturedItems: vscode.QuickPickItem[] = [];
		(vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
			capturedItems = items;
			return undefined;
		};

		const repo = makeRepo([], []);
		await pickBranch(repo, { placeHolder: 'Pick' });

		assert.strictEqual(capturedItems.length, 0);
	});

	test('skips branches with empty names', async () => {
		let capturedItems: vscode.QuickPickItem[] = [];
		(vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
			capturedItems = items;
			return undefined;
		};

		const repo = makeRepo(['main', '', 'dev'], ['', 'origin/staging']);
		await pickBranch(repo, { placeHolder: 'Pick' });

		const names = capturedItems.map(i => i.label.replace(/^\$\(git-branch\)\s*/, ''));
		assert.ok(!names.includes(''));
		assert.strictEqual(names.length, 3);
	});

	test('current branch not duplicated in local list', async () => {
		let capturedItems: vscode.QuickPickItem[] = [];
		(vscode.window as any).showQuickPick = async (items: vscode.QuickPickItem[]) => {
			capturedItems = items;
			return items[0];
		};

		const repo = makeRepo(['main', 'dev'], []);
		await pickBranch(repo, { placeHolder: 'Pick', currentBranch: 'dev' });

		const names = capturedItems.map(i => i.label.replace(/^\$\(git-branch\)\s*/, ''));
		const devCount = names.filter(n => n === 'dev').length;
		assert.strictEqual(devCount, 1, 'current branch should appear exactly once');
		assert.strictEqual(capturedItems[0].description, 'current branch');
	});
});
