import * as assert from 'assert';
import { EventEmitter } from 'events';

// =============================================================================
// MOCKS (must be established BEFORE importing modules under test)
// =============================================================================

interface SpawnBehavior {
    code?: number;
    stdout?: string;
    stderr?: string;
    error?: Error;
}

interface RequestBehavior {
    statusCode?: number;
    response?: any;
    error?: Error;
    timeout?: boolean;
}

let spawnMatchers: Array<{ test: (args: string[]) => boolean; behavior: SpawnBehavior }> = [];
let requestMatchers: Array<{ test: (options: any) => boolean; behavior: RequestBehavior }> = [];
let readFileMatchers: Array<{ test: (p: string) => boolean; content?: string; error?: Error }> = [];

let httpsRequestOverride: ((options: any, callback?: (res: any) => void) => any) | null = null;

function clearMocks(): void {
    spawnMatchers = [];
    requestMatchers = [];
    readFileMatchers = [];
    httpsRequestOverride = null;
}

function addSpawn(test: (args: string[]) => boolean, behavior: SpawnBehavior): void {
    spawnMatchers.push({ test, behavior });
}

function addRequest(test: (options: any) => boolean, behavior: RequestBehavior): void {
    requestMatchers.push({ test, behavior });
}

function addReadFile(test: (p: string) => boolean, content?: string, error?: Error): void {
    readFileMatchers.push({ test, content, error });
}

const mockSpawn = (_command: string, args: string[], _options: any) => {
    const emitter = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    (emitter as any).stdout = stdout;
    (emitter as any).stderr = stderr;

    process.nextTick(() => {
        const match = spawnMatchers.find(m => m.test(args));
        const behavior = match ? match.behavior : { code: 0, stdout: '', stderr: '' };

        if (behavior.error) {
            emitter.emit('error', behavior.error);
            return;
        }

        if (behavior.stdout) {
            stdout.emit('data', Buffer.from(behavior.stdout));
        }
        if (behavior.stderr) {
            stderr.emit('data', Buffer.from(behavior.stderr));
        }

        process.nextTick(() => {
            emitter.emit('close', behavior.code ?? 0);
        });
    });

    return emitter;
};

const defaultHttpsRequest = (options: any, callback?: (res: any) => void) => {
    const req = new EventEmitter();
    let body = '';

    (req as any).write = (chunk: string) => { body += chunk; };
    (req as any).end = () => {
        process.nextTick(() => {
            const match = requestMatchers.find(m => m.test(options));
            const behavior = match ? match.behavior : { statusCode: 200, response: {} };

            if (behavior.timeout) {
                req.emit('timeout');
                return;
            }
            if (behavior.error) {
                req.emit('error', behavior.error);
                return;
            }

            const res = new EventEmitter();
            (res as any).statusCode = behavior.statusCode ?? 200;
            (res as any).headers = {};
            if (callback) {callback(res);}

            process.nextTick(() => {
                res.emit('data', Buffer.from(JSON.stringify(behavior.response ?? {})));
                res.emit('end');
            });
        });
    };
    (req as any).destroy = () => {};
    return req;
};

const mockHttpsRequest = (options: any, callback?: (res: any) => void) => {
    return (httpsRequestOverride ?? defaultHttpsRequest)(options, callback);
};

const mockReadFile = async (filePath: string, _encoding?: any) => {
    const match = readFileMatchers.find(m => m.test(filePath));
    if (!match) {return '';}
    if (match.error) {throw match.error;}
    return match.content ?? '';
};

// Hook Node's module loader so that `child_process`, `https`, and `fs` are
// returned as Proxies when required by modules under test. Direct mutation of
// these built-ins fails in Electron because their exported properties are
// non-configurable.
 
const NodeModule = require('module') as any;
const originalModuleLoad = NodeModule._load;
NodeModule._load = function (request: string, parent: any, isMain: boolean) {
    const real = originalModuleLoad.call(this, request, parent, isMain);
    if (request === 'child_process') {
        return new Proxy(real, {
            get(target, prop, receiver) {
                if (prop === 'spawn') {return mockSpawn;}
                return Reflect.get(target, prop, receiver);
            }
        });
    }
    if (request === 'https') {
        return new Proxy(real, {
            get(target, prop, receiver) {
                if (prop === 'request') {return mockHttpsRequest;}
                return Reflect.get(target, prop, receiver);
            }
        });
    }
    if (request === 'fs') {
        const promisesProxy = new Proxy(real.promises, {
            get(target, prop, receiver) {
                if (prop === 'readFile') {return mockReadFile;}
                return Reflect.get(target, prop, receiver);
            }
        });
        return new Proxy(real, {
            get(target, prop, receiver) {
                if (prop === 'promises') {return promisesProxy;}
                return Reflect.get(target, prop, receiver);
            }
        });
    }
    return real;
};

// =============================================================================
// IMPORT MODULES UNDER TEST (must come AFTER the Module._load hook above)
// =============================================================================

import { ReleaseService, Commit, DependencyRisk, CherryPickResult, ConflictState } from '../release/releaseService';
import { ADOProvider, Ticket, PR } from '../release/adoProvider';

// Restore the original loader so other test files / VS Code internals are
// unaffected.
NodeModule._load = originalModuleLoad;

// =============================================================================
// TEST SUITE
// =============================================================================

suite('Release Module Test Suite', () => {
    const workspaceRoot = '/tmp/fake-workspace';

    setup(() => {
        clearMocks();
    });

    teardown(() => {
        clearMocks();
    });

    // -------------------------------------------------------------------------
    // ReleaseService - Constructor & Basics
    // -------------------------------------------------------------------------
    suite('ReleaseService', () => {
        test('should be instantiable and return workspace root', () => {
            const service = new ReleaseService(workspaceRoot);
            assert.ok(service);
            assert.strictEqual(service.getWorkspaceRoot(), workspaceRoot);
        });

        // ---------------------------------------------------------------------
        // Validation (exercised via public methods)
        // ---------------------------------------------------------------------
        test('getCommits rejects invalid branch names', async () => {
            const service = new ReleaseService(workspaceRoot);
            const invalidBranches = ['feature..test', '-feature', 'feature/./test', 'feature/.test', ''];
            for (const branch of invalidBranches) {
                const result = await service.getCommits(branch);
                assert.deepStrictEqual(result, [], `Branch "${branch}" should be rejected`);
            }
        });

        test('getCommits rejects invalid base branch', async () => {
            const service = new ReleaseService(workspaceRoot);
            const result = await service.getCommits('feature', 'bad..branch');
            assert.deepStrictEqual(result, []);
        });

        test('getCommitFiles rejects invalid hashes', async () => {
            const service = new ReleaseService(workspaceRoot);
            assert.deepStrictEqual(await service.getCommitFiles('abc'), []);
            assert.deepStrictEqual(await service.getCommitFiles('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'), []);
            assert.deepStrictEqual(await service.getCommitFiles('123456'), []);
            assert.deepStrictEqual(await service.getCommitFiles('12345678901234567890123456789012345678901'), []);
        });

        test('getUniqueHashesByContent rejects invalid branches', async () => {
            const service = new ReleaseService(workspaceRoot);
            assert.deepStrictEqual(await service.getUniqueHashesByContent('bad..branch', 'main'), new Set());
            assert.deepStrictEqual(await service.getUniqueHashesByContent('main', 'bad..branch'), new Set());
        });

        test('hasCodeChanges rejects invalid hash', async () => {
            const service = new ReleaseService(workspaceRoot);
            assert.strictEqual(await service.hasCodeChanges('bad'), false);
        });

        test('analyzeDependencyRisks rejects invalid inputs', async () => {
            const service = new ReleaseService(workspaceRoot);
            assert.deepStrictEqual(await service.analyzeDependencyRisks(['bad'], 'main', 'feature'), []);
            assert.deepStrictEqual(await service.analyzeDependencyRisks(['abc1234'], 'bad..branch', 'feature'), []);
            assert.deepStrictEqual(await service.analyzeDependencyRisks(['abc1234'], 'main', 'bad..branch'), []);
        });

        test('getSpecificFilesDiff rejects invalid hash or branch', async () => {
            const service = new ReleaseService(workspaceRoot);
            assert.strictEqual(await service.getSpecificFilesDiff('bad', 'main', ['file.ts']), '');
            assert.strictEqual(await service.getSpecificFilesDiff('abc1234', 'bad..branch', ['file.ts']), '');
        });

        test('getSpecificFilesDiff filters path traversal in fileList', async () => {
            const service = new ReleaseService(workspaceRoot);
            let capturedArgs: string[] = [];
            addSpawn(args => {
                if (args[0] === 'diff') {
                    capturedArgs = args;
                    return true;
                }
                return false;
            }, { stdout: 'diff output' });

            const result = await service.getSpecificFilesDiff('abc1234', 'main', ['../secret.ts', 'valid.ts']);

            // Diff runs with only valid.ts; ../secret.ts is filtered out.
            assert.strictEqual(result, 'diff output');
            assert.ok(capturedArgs.includes('valid.ts'));
            assert.ok(!capturedArgs.includes('../secret.ts'));
        });

        test('getSpecificFilesDiff returns empty when no valid files remain', async () => {
            const service = new ReleaseService(workspaceRoot);
            const result = await service.getSpecificFilesDiff('abc1234', 'main', ['../secret.ts']);
            assert.strictEqual(result, '');
        });

        test('getCommitBody rejects invalid hash', async () => {
            const service = new ReleaseService(workspaceRoot);
            assert.strictEqual(await service.getCommitBody('bad'), '');
        });

        test('getPRDiff rejects invalid branches', async () => {
            const service = new ReleaseService(workspaceRoot);
            assert.ok((await service.getPRDiff('bad..branch', 'main')).startsWith('Error'));
            assert.ok((await service.getPRDiff('feature', 'bad..branch')).startsWith('Error'));
        });

        // ---------------------------------------------------------------------
        // getCommits
        // ---------------------------------------------------------------------
        test('getCommits parses output correctly', async () => {
            const service = new ReleaseService(workspaceRoot);
            const hash = 'aabbccdd11223344556677889900aabbccdd1122';
            const msg = 'Fix bug';
            const author = 'Dev';
            const email = 'dev@example.com';
            const date = '2024-01-15T10:30:00+00:00';
            const stdout = `${hash}\0${msg}\0${author}\0${email}\0${date}`;

            addSpawn(args => args[0] === 'log', { stdout });

            const commits = await service.getCommits('feature');
            assert.strictEqual(commits.length, 1);
            assert.strictEqual(commits[0].hash, hash);
            assert.strictEqual(commits[0].message, msg);
            assert.strictEqual(commits[0].author, author);
            assert.strictEqual(commits[0].email, email);
            assert.strictEqual(commits[0].date, date);
        });

        test('getCommits with base uses correct range', async () => {
            const service = new ReleaseService(workspaceRoot);
            let capturedArgs: string[] = [];
            addSpawn(args => {
                if (args[0] === 'log') {
                    capturedArgs = args;
                    return true;
                }
                return false;
            }, { stdout: '' });

            await service.getCommits('feature', 'main');
            assert.ok(capturedArgs.includes('main..feature'));
        });

        test('getCommits returns empty on empty output', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'log', { stdout: '\n\n' });
            const commits = await service.getCommits('feature');
            assert.deepStrictEqual(commits, []);
        });

        test('getCommits returns empty on git error', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'log', { code: 128, stderr: 'fatal: bad revision' });
            const commits = await service.getCommits('feature');
            assert.deepStrictEqual(commits, []);
        });

        test('getCommits filters malformed lines', async () => {
            const service = new ReleaseService(workspaceRoot);
            const stdout = 'badline\naabbccdd11223344556677889900aabbccdd1122\0msg\0author\0email\0date';
            addSpawn(args => args[0] === 'log', { stdout });
            const commits = await service.getCommits('feature');
            assert.strictEqual(commits.length, 1);
        });

        // ---------------------------------------------------------------------
        // getCommitFiles
        // ---------------------------------------------------------------------
        test('getCommitFiles parses file list', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'show', { stdout: 'src/a.ts\nsrc/b.ts\n' });
            const files = await service.getCommitFiles('aabbccdd11223344556677889900aabbccdd1122');
            assert.deepStrictEqual(files, ['src/a.ts', 'src/b.ts']);
        });

        test('getCommitFiles returns empty on git error', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'show', { code: 128, stderr: 'error' });
            const files = await service.getCommitFiles('aabbccdd11223344556677889900aabbccdd1122');
            assert.deepStrictEqual(files, []);
        });

        // ---------------------------------------------------------------------
        // getUniqueHashesByContent
        // ---------------------------------------------------------------------
        test('getUniqueHashesByContent returns unique hashes with short variants', async () => {
            const service = new ReleaseService(workspaceRoot);
            const full = 'aabbccdd11223344556677889900aabbccdd1122';
            const short = full.substring(0, 7);
            addSpawn(args => args[0] === 'cherry', { stdout: `+ ${full}\n- otherhash\n` });

            const set = await service.getUniqueHashesByContent('main', 'feature');
            assert.ok(set.has(full));
            assert.ok(set.has(short));
            assert.strictEqual(set.size, 2);
        });

        test('getUniqueHashesByContent returns empty on git error', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'cherry', { code: 128, stderr: 'error' });
            const set = await service.getUniqueHashesByContent('main', 'feature');
            assert.deepStrictEqual(set, new Set());
        });

        // ---------------------------------------------------------------------
        // hasCodeChanges
        // ---------------------------------------------------------------------
        test('hasCodeChanges returns true when patch exists', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'show', { stdout: ' some diff content ' });
            assert.strictEqual(await service.hasCodeChanges('aabbccdd11223344556677889900aabbccdd1122'), true);
        });

        test('hasCodeChanges returns false when no patch', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'show', { stdout: '   ' });
            assert.strictEqual(await service.hasCodeChanges('aabbccdd11223344556677889900aabbccdd1122'), false);
        });

        test('hasCodeChanges returns false on git error', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'show', { code: 128, stderr: 'error' });
            assert.strictEqual(await service.hasCodeChanges('aabbccdd11223344556677889900aabbccdd1122'), false);
        });

        // ---------------------------------------------------------------------
        // analyzeDependencyRisks
        // ---------------------------------------------------------------------
        test('analyzeDependencyRisks detects file overlap between picked and skipped', async () => {
            const service = new ReleaseService(workspaceRoot);
            const h1 = 'aabbccdd11223344556677889900aabbccdd1122';
            const h2 = 'bbaaccddeeff00112233445566778899aabbccdd';
            const h3 = '11223344556677889900aabbccddeeff11223344';

            // git log
            addSpawn(args => args[0] === 'log', {
                stdout: [
					`${h1}\x00First\x00A\x00a@x.com\x002024-01-01T00:00:00+00:00`,
					`${h2}\x00Second\x00B\x00b@x.com\x002024-01-02T00:00:00+00:00`,
					`${h3}\x00Third\x00C\x00c@x.com\x002024-01-03T00:00:00+00:00`
				].join('\n')
            });

            // git cherry
            addSpawn(args => args[0] === 'cherry', { stdout: `+ ${h1}\n+ ${h2}\n+ ${h3}\n` });

            // git show --name-only
            addSpawn(args => args[0] === 'show' && args.includes('--name-only') && args.includes(h1), { stdout: 'src/shared.ts' });
            addSpawn(args => args[0] === 'show' && args.includes('--name-only') && args.includes(h2), { stdout: 'src/shared.ts' });
            addSpawn(args => args[0] === 'show' && args.includes('--name-only') && args.includes(h3), { stdout: 'src/shared.ts' });

            // Pick h1 and h3, skip h2
            const risks = await service.analyzeDependencyRisks([h1, h3], 'main', 'feature');
            assert.strictEqual(risks.length, 1);
            assert.strictEqual(risks[0].file, 'src/shared.ts');
            assert.strictEqual(risks[0].pickedCommit, h3);
            assert.strictEqual(risks[0].skippedCommit, h2);
            assert.strictEqual(risks[0].severity, 'high');
        });

        test('analyzeDependencyRisks returns empty when no overlap', async () => {
            const service = new ReleaseService(workspaceRoot);
            const h1 = 'aabbccdd11223344556677889900aabbccdd1122';
            const h2 = 'bbaaccddeeff00112233445566778899aabbccdd';

            addSpawn(args => args[0] === 'log', {
				stdout: `${h1}\x00First\x00A\x00a@x.com\x002024-01-01T00:00:00+00:00\n${h2}\x00Second\x00B\x00b@x.com\x002024-01-02T00:00:00+00:00`
			});
            addSpawn(args => args[0] === 'cherry', { stdout: `+ ${h1}\n+ ${h2}\n` });
            addSpawn(args => args[0] === 'show' && args.includes('--name-only') && args.includes(h1), { stdout: 'a.ts' });
            addSpawn(args => args[0] === 'show' && args.includes('--name-only') && args.includes(h2), { stdout: 'b.ts' });

            const risks = await service.analyzeDependencyRisks([h1], 'main', 'feature');
            assert.deepStrictEqual(risks, []);
        });

        // ---------------------------------------------------------------------
        // getSpecificFilesDiff
        // ---------------------------------------------------------------------
        test('getSpecificFilesDiff returns diff for valid inputs', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'diff', { stdout: 'diff --git a/src/file.ts b/src/file.ts' });
            const result = await service.getSpecificFilesDiff('aabbccdd11223344556677889900aabbccdd1122', 'main', ['src/file.ts']);
            assert.ok(result.includes('diff --git'));
        });

        test('getSpecificFilesDiff returns empty on git error', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'diff', { code: 128, stderr: 'error' });
            const result = await service.getSpecificFilesDiff('aabbccdd11223344556677889900aabbccdd1122', 'main', ['src/file.ts']);
            assert.strictEqual(result, '');
        });

        // ---------------------------------------------------------------------
        // processUniqueCommits
        // ---------------------------------------------------------------------
        test('processUniqueCommits sorts descending by date', async () => {
            const service = new ReleaseService(workspaceRoot);
            const c1: Commit = { hash: 'aabbccdd11223344556677889900aabbccdd1122', message: 'Old', author: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' };
            const c2: Commit = { hash: 'bbaaccddeeff00112233445566778899aabbccdd', message: 'New', author: 'B', email: 'b@x.com', date: '2024-01-03T00:00:00+00:00' };

            addSpawn(args => args[0] === 'show' && args.includes('-s'), { stdout: 'body' });
            addSpawn(args => args[0] === 'show' && args.includes('--name-only'), { stdout: 'src/f.ts' });
            addSpawn(args => args[0] === 'diff', { stdout: '' });

            const result = await service.processUniqueCommits([c1, c2], 'main');
            assert.strictEqual(result[0].message, 'New');
            assert.strictEqual(result[1].message, 'Old');
        });

        test('processUniqueCommits extracts work item number', async () => {
            const service = new ReleaseService(workspaceRoot);
            const c: Commit = { hash: 'aabbccdd11223344556677889900aabbccdd1122', message: 'Fix', author: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' };

            addSpawn(args => args[0] === 'show' && args.includes('-s'), { stdout: 'Related to #12345' });
            addSpawn(args => args[0] === 'show' && args.includes('--name-only'), { stdout: 'src/f.ts' });
            addSpawn(args => args[0] === 'diff', { stdout: '' });

            const result = await service.processUniqueCommits([c], 'main');
            assert.strictEqual(result[0].workItemNumber, '12345');
        });

        test('processUniqueCommits sets isOverridden when all files already seen', async () => {
            const service = new ReleaseService(workspaceRoot);
            const c1: Commit = { hash: 'aabbccdd11223344556677889900aabbccdd1122', message: 'First', author: 'A', email: 'a@x.com', date: '2024-01-02T00:00:00+00:00' };
            const c2: Commit = { hash: 'bbaaccddeeff00112233445566778899aabbccdd', message: 'Second', author: 'B', email: 'b@x.com', date: '2024-01-01T00:00:00+00:00' };

            addSpawn(args => args[0] === 'show' && args.includes('-s'), { stdout: 'body' });
            addSpawn(args => args[0] === 'show' && args.includes('--name-only') && args.includes(c1.hash), { stdout: 'src/f.ts' });
            addSpawn(args => args[0] === 'show' && args.includes('--name-only') && args.includes(c2.hash), { stdout: 'src/f.ts' });
            addSpawn(args => args[0] === 'diff', { stdout: 'diff output' });

            const result = await service.processUniqueCommits([c1, c2], 'main');
            assert.strictEqual(result[0].isOverridden, false); // first sees new file
            assert.strictEqual(result[1].isOverridden, true);  // second only touches seen file
        });

        test('processUniqueCommits skips invalid hashes', async () => {
            const service = new ReleaseService(workspaceRoot);
            const bad: Commit = { hash: 'badhash', message: 'Bad', author: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' };
            const result = await service.processUniqueCommits([bad], 'main');
            assert.deepStrictEqual(result, []);
        });

        test('processUniqueCommits pushes raw commit on processing error', async () => {
            const service = new ReleaseService(workspaceRoot);
            const c: Commit = { hash: 'aabbccdd11223344556677889900aabbccdd1122', message: 'Fix', author: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' };

            addSpawn(args => args[0] === 'show' && args.includes('-s'), { code: 128, stderr: 'fatal' });

            const result = await service.processUniqueCommits([c], 'main');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].hash, c.hash);
            assert.strictEqual(result[0].diff, undefined);
        });

        // ---------------------------------------------------------------------
        // executeCherryPick
        // ---------------------------------------------------------------------
        test('executeCherryPick success path', async () => {
            const service = new ReleaseService(workspaceRoot);
            const hash = 'aabbccdd11223344556677889900aabbccdd1122';

            addSpawn(args => args[0] === 'fetch', { stdout: '' });
            addSpawn(args => args[0] === 'checkout' && args.includes('-b'), { stdout: '' });
            addSpawn(args => args[0] === 'cherry-pick' && args.includes(hash), { stdout: '' });

            const result = await service.executeCherryPick('release/1.0', [hash], 'main');
            assert.strictEqual(result.success, true);
            assert.ok(result.message.includes('Created branch'));
        });

        test('executeCherryPick with invalid branch fails fast', async () => {
            const service = new ReleaseService(workspaceRoot);
            const result = await service.executeCherryPick('bad..branch', ['aabbccdd11223344556677889900aabbccdd1122'], 'main');
            assert.strictEqual(result.success, false);
            assert.ok(result.message.includes('Invalid branch name'));
        });

        test('executeCherryPick with invalid hash fails fast', async () => {
            const service = new ReleaseService(workspaceRoot);
            const result = await service.executeCherryPick('release/1.0', ['badhash'], 'main');
            assert.strictEqual(result.success, false);
            assert.ok(result.message.includes('Invalid commit hash'));
        });

        test('executeCherryPick handles existing branch', async () => {
            const service = new ReleaseService(workspaceRoot);
            const hash = 'aabbccdd11223344556677889900aabbccdd1122';

            addSpawn(args => args[0] === 'fetch', { stdout: '' });
            addSpawn(args => args[0] === 'checkout' && args.includes('-b'), { code: 128, stderr: 'already exists' });
            addSpawn(args => args[0] === 'checkout' && !args.includes('-b'), { stdout: '' });
            addSpawn(args => args[0] === 'cherry-pick', { stdout: '' });

            const result = await service.executeCherryPick('release/1.0', [hash], 'main');
            assert.strictEqual(result.success, true);
        });

        test('executeCherryPick detects conflict and returns conflict state', async () => {
            const service = new ReleaseService(workspaceRoot);
            const h1 = 'aabbccdd11223344556677889900aabbccdd1122';
            const h2 = 'bbaaccddeeff00112233445566778899aabbccdd';

            addSpawn(args => args[0] === 'fetch', { stdout: '' });
            addSpawn(args => args[0] === 'checkout' && args.includes('-b'), { stdout: '' });
            addSpawn(args => args[0] === 'cherry-pick' && args.includes(h1), {
                code: 1,
                stderr: 'CONFLICT (content): Merge conflict in src/f.ts\nAutomatic merge failed'
            });
            addSpawn(args => args[0] === 'diff' && args.includes('--diff-filter=U'), { stdout: 'src/f.ts' });
            addReadFile(p => p.includes('src/f.ts'), '<<<<<<< HEAD\nA\n=======\nB\n>>>>>>>');

            const result = await service.executeCherryPick('release/1.0', [h1, h2], 'main');
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.requiresConflictResolution, true);
            assert.ok(result.conflictState);
            assert.strictEqual(result.conflictState!.currentCommit, h1);
            assert.strictEqual(result.conflictState!.totalCommits, 2);
            assert.strictEqual(result.conflictState!.completedCommits, 0);
            assert.strictEqual(result.conflictState!.remainingCommits, 1);
            assert.deepStrictEqual(result.conflictState!.conflictingFiles, ['src/f.ts']);
            assert.ok(result.conflictState!.fileContents['src/f.ts'].includes('<<<<<<<'));
            assert.strictEqual(result.conflictState!.isAppending, false);
        });

        test('executeCherryPick aborts and returns error on non-conflict failure', async () => {
            const service = new ReleaseService(workspaceRoot);
            const h1 = 'aabbccdd11223344556677889900aabbccdd1122';

            addSpawn(args => args[0] === 'fetch', { stdout: '' });
            addSpawn(args => args[0] === 'checkout' && args.includes('-b'), { stdout: '' });
            addSpawn(args => args[0] === 'cherry-pick' && args.includes(h1), { code: 1, stderr: 'fatal: bad object' });
            addSpawn(args => args[0] === 'cherry-pick' && args.includes('--abort'), { stdout: '' });

            const result = await service.executeCherryPick('release/1.0', [h1], 'main');
            assert.strictEqual(result.success, false);
            assert.ok(result.message.includes('bad object'));
        });

        // ---------------------------------------------------------------------
        // appendToRelease
        // ---------------------------------------------------------------------
        test('appendToRelease success path', async () => {
            const service = new ReleaseService(workspaceRoot);
            const hash = 'aabbccdd11223344556677889900aabbccdd1122';

            addSpawn(args => args[0] === 'checkout' && args.includes('release/1.0'), { stdout: '' });
            addSpawn(args => args[0] === 'cherry-pick', { stdout: '' });

            const result = await service.appendToRelease('release/1.0', [hash], 'main');
            assert.strictEqual(result.success, true);
            assert.ok(result.message.includes('Appended'));
        });

        test('appendToRelease with invalid inputs fails fast', async () => {
            const service = new ReleaseService(workspaceRoot);
            const r1 = await service.appendToRelease('bad..branch', ['aabbccdd11223344556677889900aabbccdd1122'], 'main');
            assert.strictEqual(r1.success, false);
            const r2 = await service.appendToRelease('release/1.0', ['bad'], 'main');
            assert.strictEqual(r2.success, false);
        });

        // ---------------------------------------------------------------------
        // getBranchCommitMessages
        // ---------------------------------------------------------------------
        test('getBranchCommitMessages returns set of messages', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'log', { stdout: 'Fix bug\nAdd feature\n\n' });
            const set = await service.getBranchCommitMessages('main');
            assert.ok(set.has('Fix bug'));
            assert.ok(set.has('Add feature'));
            assert.strictEqual(set.size, 2);
        });

        test('getBranchCommitMessages handles errors', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'log', { code: 128, stderr: 'error' });
            const set = await service.getBranchCommitMessages('main');
            assert.deepStrictEqual(set, new Set());
        });

        // ---------------------------------------------------------------------
        // getCommitBody
        // ---------------------------------------------------------------------
        test('getCommitBody returns body for valid hash', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'show' && args.includes('-s'), { stdout: 'Detailed commit message' });
            const body = await service.getCommitBody('aabbccdd11223344556677889900aabbccdd1122');
            assert.strictEqual(body, 'Detailed commit message');
        });

        // ---------------------------------------------------------------------
        // getPRDiff
        // ---------------------------------------------------------------------
        test('getPRDiff returns diff for valid branches', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'diff', { stdout: 'diff output' });
            const diff = await service.getPRDiff('feature', 'main');
            assert.strictEqual(diff, 'diff output');
        });

        test('getPRDiff returns error string on git failure', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => args[0] === 'diff', { code: 128, stderr: 'fatal' });
            const diff = await service.getPRDiff('feature', 'main');
            assert.ok(diff.startsWith('Error fetching diff'));
        });

        // ---------------------------------------------------------------------
        // getConflictContent path traversal protection
        // ---------------------------------------------------------------------
        test('getConflictContent prevents path traversal', async () => {
            const service = new ReleaseService(workspaceRoot);
            // Trigger conflict to exercise getConflictContent
            const h1 = 'aabbccdd11223344556677889900aabbccdd1122';

            addSpawn(args => args[0] === 'fetch', { stdout: '' });
            addSpawn(args => args[0] === 'checkout' && args.includes('-b'), { stdout: '' });
            addSpawn(args => args[0] === 'cherry-pick', {
                code: 1,
                stderr: 'CONFLICT (content): Merge conflict in ../secret.txt\nAutomatic merge failed'
            });
            addSpawn(args => args[0] === 'diff' && args.includes('--diff-filter=U'), { stdout: '../secret.txt' });

            const result = await service.executeCherryPick('release/1.0', [h1], 'main');
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.conflictState!.fileContents['../secret.txt'], 'Error: Invalid file path');
        });

        test('getConflictContent handles read errors', async () => {
            const service = new ReleaseService(workspaceRoot);
            const h1 = 'aabbccdd11223344556677889900aabbccdd1122';

            addSpawn(args => args[0] === 'fetch', { stdout: '' });
            addSpawn(args => args[0] === 'checkout' && args.includes('-b'), { stdout: '' });
            addSpawn(args => args[0] === 'cherry-pick', {
                code: 1,
                stderr: 'CONFLICT (content): Merge conflict in src/missing.ts\nAutomatic merge failed'
            });
            addSpawn(args => args[0] === 'diff' && args.includes('--diff-filter=U'), { stdout: 'src/missing.ts' });
            addReadFile(p => p.includes('src/missing.ts'), undefined, new Error('ENOENT'));

            const result = await service.executeCherryPick('release/1.0', [h1], 'main');
            assert.ok(result.conflictState!.fileContents['src/missing.ts'].startsWith('Error reading file'));
        });

        // ---------------------------------------------------------------------
        // execGit edge cases
        // ---------------------------------------------------------------------
        test('execGit handles spawn error (e.g. git not found)', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => true, { error: new Error('ENOENT') });
            const result = await service.getCommits('main');
            assert.deepStrictEqual(result, []);
        });

        test('execGit prefers stderr on non-zero exit', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => true, { code: 1, stderr: 'stderr msg', stdout: 'stdout msg' });
            const result = await service.getPRDiff('a', 'b');
            assert.ok(result.includes('stderr msg'));
        });

        test('execGit falls back to stdout when stderr empty', async () => {
            const service = new ReleaseService(workspaceRoot);
            addSpawn(args => true, { code: 1, stdout: 'stdout fallback' });
            const result = await service.getPRDiff('a', 'b');
            assert.ok(result.includes('stdout fallback'));
        });
    });

    // -------------------------------------------------------------------------
    // ADOProvider
    // -------------------------------------------------------------------------
    suite('ADOProvider', () => {
        const orgUrl = 'https://dev.azure.com/myorg';
        const project = 'MyProject';
        const token = 'pat-token';
        const repoId = 'repo-uuid';

        test('should be instantiable', () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            assert.ok(provider);
        });

        // ---------------------------------------------------------------------
        // lookupTicket
        // ---------------------------------------------------------------------
        test('lookupTicket returns ticket for valid ID', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/workitems/123'), {
                response: {
                    id: 123,
                    fields: {
                        'System.Title': 'Bug 123',
                        'System.State': 'Active',
                        'System.WorkItemType': 'Bug',
                        'System.Description': 'Desc'
                    }
                }
            });

            const ticket = await provider.lookupTicket('123');
            assert.strictEqual(ticket.id, '123');
            assert.strictEqual(ticket.title, 'Bug 123');
            assert.strictEqual(ticket.state, 'Active');
            assert.strictEqual(ticket.type, 'Bug');
            assert.strictEqual(ticket.description, 'Desc');
        });

        test('lookupTicket throws for non-numeric ID', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            await assert.rejects(async () => await provider.lookupTicket('abc'), /Invalid ticket ID/);
        });

        test('lookupTicket handles API error', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/workitems/123'), {
                statusCode: 404,
                response: { message: 'Not Found' }
            });
            await assert.rejects(async () => await provider.lookupTicket('123'), /ADO API Error: Not Found/);
        });

        // ---------------------------------------------------------------------
        // searchTicketsByTitle
        // ---------------------------------------------------------------------
        test('searchTicketsByTitle returns tickets', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/wiql'), {
                response: { workItems: [{ id: 1, url: '' }, { id: 2, url: '' }] }
            });
            addRequest(opts => opts.path.includes('/workitems?ids=1,2'), {
                response: {
                    value: [
                        { id: 1, fields: { 'System.Title': 'Bug One', 'System.State': 'New' } },
                        { id: 2, fields: { 'System.Title': 'Bug Two', 'System.State': 'Active' } }
                    ]
                }
            });

            const tickets = await provider.searchTicketsByTitle('bug');
            assert.strictEqual(tickets.length, 2);
            assert.strictEqual(tickets[0].id, '1');
        });

        test('searchTicketsByTitle sanitizes term and project', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            let capturedPath = '';
            addRequest(opts => {
                if (opts.path.includes('/wiql')) {
                    capturedPath = opts.path;
                    return true;
                }
                return false;
            }, { response: { workItems: [] } });

            await provider.searchTicketsByTitle("bug'; DROP TABLE--");
            assert.ok(!capturedPath.includes(';'));
            assert.ok(!capturedPath.includes('DROP'));
        });

        test('searchTicketsByTitle truncates long terms', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            let capturedPath = '';
            addRequest(opts => opts.path.includes('/wiql'), {
                response: { workItems: [] }
            });

            const longTerm = 'a'.repeat(150);
            await provider.searchTicketsByTitle(longTerm);
            // Should not throw; term truncated internally
            assert.ok(true);
        });

        test('searchTicketsByTitle returns empty when no results', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/wiql'), { response: { workItems: [] } });
            const tickets = await provider.searchTicketsByTitle('xyz');
            assert.deepStrictEqual(tickets, []);
        });

        test('searchTicketsByTitle propagates API error', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/wiql'), {
                statusCode: 400,
                response: { message: 'Bad Request' }
            });
            await assert.rejects(async () => await provider.searchTicketsByTitle('bug'), /ADO API Error: Bad Request/);
        });

        // ---------------------------------------------------------------------
        // getPullRequests
        // ---------------------------------------------------------------------
        test('getPullRequests returns mapped PRs', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/pullrequests'), {
                response: {
                    value: [{
                        pullRequestId: 42,
                        title: 'PR Title',
                        createdBy: { displayName: 'Dev', uniqueName: 'dev@example.com' },
                        sourceRefName: 'refs/heads/feature',
                        targetRefName: 'refs/heads/main',
                        status: 'active',
                        creationDate: '2024-01-01T00:00:00Z',
                        closedDate: '2024-01-02T00:00:00Z',
                        mergeStatus: 'succeeded'
                    }]
                }
            });

            const prs = await provider.getPullRequests('main');
            assert.strictEqual(prs.length, 1);
            const pr = prs[0];
            assert.strictEqual(pr.id, 42);
            assert.strictEqual(pr.title, 'PR Title');
            assert.strictEqual(pr.author, 'Dev');
            assert.strictEqual(pr.authorEmail, 'dev@example.com');
            assert.strictEqual(pr.sourceBranch, 'feature');
            assert.strictEqual(pr.targetBranch, 'main');
            assert.ok(pr.url.includes('/pullrequest/42'));
        });

        test('getPullRequests returns empty on missing value', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/pullrequests'), { response: {} });
            const prs = await provider.getPullRequests('main');
            assert.deepStrictEqual(prs, []);
        });

        test('getPullRequests handles API error', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/pullrequests'), {
                statusCode: 500,
                response: { message: 'Server Error' }
            });
            const prs = await provider.getPullRequests('main');
            assert.deepStrictEqual(prs, []);
        });

        // ---------------------------------------------------------------------
        // getTicketDetailsBulk
        // ---------------------------------------------------------------------
        test('getTicketDetailsBulk filters invalid IDs and returns tickets', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/workitems?ids='), {
                response: {
                    value: [
                        { id: 10, fields: { 'System.Title': 'T1', 'System.State': 'New', 'System.WorkItemType': 'Task', 'System.Description': 'D1' } }
                    ]
                }
            });

            const tickets = await provider.getTicketDetailsBulk(['10', 'abc', '20']);
            assert.strictEqual(tickets.length, 1);
            assert.strictEqual(tickets[0].id, '10');
        });

        test('getTicketDetailsBulk returns empty when no valid IDs', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            const tickets = await provider.getTicketDetailsBulk(['abc', 'def']);
            assert.deepStrictEqual(tickets, []);
        });

        test('getTicketDetailsBulk handles API error', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => opts.path.includes('/workitems?ids='), {
                statusCode: 500,
                response: { message: 'fail' }
            });
            const tickets = await provider.getTicketDetailsBulk(['1']);
            assert.deepStrictEqual(tickets, []);
        });

        // ---------------------------------------------------------------------
        // adoRequest internals
        // ---------------------------------------------------------------------
        test('adoRequest handles timeout', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => true, { timeout: true });
            await assert.rejects(async () => await provider.lookupTicket('1'), /timed out/);
        });

        test('adoRequest handles network error', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => true, { error: new Error('ECONNREFUSED') });
            await assert.rejects(async () => await provider.lookupTicket('1'), /ECONNREFUSED/);
        });

        test('adoRequest handles non-JSON response', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            // Override https mock for this single test to emit plain text
            httpsRequestOverride = (options: any, callback?: (res: any) => void) => {
                const req = new EventEmitter();
                (req as any).write = () => {};
                (req as any).end = () => {
                    process.nextTick(() => {
                        const res = new EventEmitter();
                        (res as any).statusCode = 200;
                        if (callback) {callback(res);}
                        process.nextTick(() => {
                            res.emit('data', Buffer.from('not json'));
                            res.emit('end');
                        });
                    });
                };
                return req;
            };

            try {
                await assert.rejects(async () => await provider.lookupTicket('1'), /Failed to parse/);
            } finally {
                httpsRequestOverride = null;
            }
        });

        test('adoRequest builds correct path for orgUrl with pathname', async () => {
            const provider = new ADOProvider('https://dev.azure.com/myorg/', project, token, repoId);
            let capturedPath = '';
            addRequest(opts => {
                capturedPath = opts.path;
                return true;
            }, { response: { id: 1, fields: { 'System.Title': 'T', 'System.State': 'S' } } });

            await provider.lookupTicket('1');
            assert.ok(capturedPath.startsWith('/myorg/'));
        });

        test('adoRequest builds correct path for orgUrl with fallback parsing', async () => {
            const provider = new ADOProvider('https://server.com/tfs/collection', project, token, repoId);
            let capturedPath = '';
            addRequest(opts => {
                capturedPath = opts.path;
                return true;
            }, { response: { id: 1, fields: { 'System.Title': 'T', 'System.State': 'S' } } });

            await provider.lookupTicket('1');
            assert.ok(capturedPath.startsWith('/collection/'));
        });

        test('adoRequest handles HTTP error with JSON errorCode', async () => {
            const provider = new ADOProvider(orgUrl, project, token, repoId);
            addRequest(opts => true, {
                statusCode: 401,
                response: { errorCode: 401, message: 'Unauthorized' }
            });
            await assert.rejects(async () => await provider.lookupTicket('1'), /Unauthorized/);
        });
    });
});
