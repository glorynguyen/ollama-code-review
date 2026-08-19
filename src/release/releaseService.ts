import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface Commit {
    hash: string;
    message: string;
    author: string;
    email: string;
    date: string;
    diff?: string;
    isOverridden?: boolean;
    isObsolete?: boolean;
    workItemNumber?: string | null;
    /** Files where target diverged from both parent and commit state — may conflict */
    divergedFiles?: string[];
    obsoleteFiles?: string[];
}

export interface DependencyRisk {
    type: string;
    file: string;
    pickedCommit: string;
    skippedCommit: string;
    skippedMessage: string;
    severity: string;
}

export interface ConflictState {
    state: string;
    branchName: string;
    baseBranch: string;
    totalCommits: number;
    completedCommits: number;
    remainingCommits: number;
    currentCommit: string;
    currentCommitIndex: number;
    selectedHashes: string[];
    conflictingFiles: string[];
    fileContents: Record<string, string>;
    isAppending: boolean;
    timestamp: string;
}

export interface CherryPickResult {
    success: boolean;
    message: string;
    requiresConflictResolution?: boolean;
    conflictState?: ConflictState;
    requiresConfirmation?: boolean;
    risks?: DependencyRisk[];
}

export interface SimulationConflictFile {
    file: string;
    conflictType: string;
    content?: string;
}

export interface CherryPickSimulationResult {
    success: boolean;
    message: string;
    conflictAtCommit?: string;
    conflictAtIndex?: number;
    conflictingFiles?: SimulationConflictFile[];
    totalSimulated: number;
}

export interface ReleaseState {
    created: string;
    base: string;
    commits: string[];
    notes: string;
}

export class ReleaseService {
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    public getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    private async execGit(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const git = spawn('git', args, {
                cwd: this.workspaceRoot,
                env: process.env
            });

            let stdout = '';
            let stderr = '';

            git.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            git.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            git.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Git error (exit code ${code}): ${stderr || stdout}`));
                }
            });

            git.on('error', (err) => {
                reject(new Error(`Failed to start git process: ${err.message}`));
            });
        });
    }

    private async execGitWithOptions(args: string[], options?: { env?: Record<string, string>; stdinData?: string; acceptExitCodes?: number[] }): Promise<string> {
        return new Promise((resolve, reject) => {
            const git = spawn('git', args, {
                cwd: this.workspaceRoot,
                env: options?.env ? { ...process.env, ...options.env } : process.env
            });

            let stdout = '';
            let stderr = '';

            git.stdout.on('data', (data) => { stdout += data.toString(); });
            git.stderr.on('data', (data) => { stderr += data.toString(); });

            const accepted = options?.acceptExitCodes ?? [0];
            git.on('close', (code) => {
                if (accepted.includes(code ?? -1)) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Git error (exit code ${code}): ${stderr || stdout}`));
                }
            });

            git.on('error', (err) => {
                reject(new Error(`Failed to start git process: ${err.message}`));
            });

            if (options?.stdinData) {
                git.stdin.write(options.stdinData);
                git.stdin.end();
            }
        });
    }

    private isValidBranchName(name: string): boolean {
        // More restrictive branch name validation to prevent command injection and path traversal
        // Disallows consecutive dots, starts with hyphen, or common traversal patterns
        const branchNameRegex = /^[\w\-\/]+(?:\.[\w\-\/]+)*$/;
        return branchNameRegex.test(name) && 
               !name.startsWith('-') && 
               !name.includes('..') && 
               !name.includes('./') && 
               !name.includes('/.');
    }

    private isValidCommitHash(hash: string): boolean {
        // Git commit hashes are 40 hex characters (full) or 7+ (short)
        const hashRegex = /^[a-fA-F0-9]{7,40}$/;
        return hashRegex.test(hash);
    }

    public async getCommits(branch: string, base?: string): Promise<Commit[]> {
        if (!this.isValidBranchName(branch) || (base && !this.isValidBranchName(base))) {
            console.error('[ReleaseService] Invalid branch name provided to getCommits');
            return [];
        }
        try {
            const range = base ? `${base}..${branch}` : branch;
            const args = ['log', range, '-n', '100', '--pretty=tformat:%H%x00%s%x00%an%x00%ae%x00%ad', '--date=iso'];
            console.log(`[ReleaseService] Executing: git ${args.join(' ')}`);
            const output = await this.execGit(args);
            if (!output.trim()) {return [];}
            return output.trim().split('\n').map(line => {
                const parts = line.split('\0');
                if (parts.length < 5) {return null;}
                const [hash, message, author, email, date] = parts;
                return { hash, message: message.trim(), author, email, date };
            }).filter((c): c is Commit => c !== null);
        } catch (error) {
            console.error('[ReleaseService] getCommits failed:', error);
            return [];
        }
    }

    public async getCommitFiles(hash: string): Promise<string[]> {
        if (!this.isValidCommitHash(hash)) {
            console.error('[ReleaseService] Invalid commit hash provided to getCommitFiles');
            return [];
        }
        try {
            const output = await this.execGit(['show', '--name-only', '--format=', hash]);
            return output.trim().split('\n').filter(Boolean);
        } catch (error) {
            console.error('[ReleaseService] getCommitFiles failed:', error);
            return [];
        }
    }

    public async getUniqueHashesByContent(upstream: string, head: string): Promise<Set<string>> {
        if (!this.isValidBranchName(upstream) || !this.isValidBranchName(head)) {
            console.error('[ReleaseService] Invalid branch name provided to getUniqueHashesByContent');
            return new Set();
        }
        try {
            console.log(`[ReleaseService] Executing: git cherry ${upstream} head`);
            const output = await this.execGit(['cherry', upstream, head]);
            const uniqueHashes = new Set<string>();
            output.trim().split('\n').forEach(line => {
                const parts = line.trim().split(' ');
                if (parts.length >= 2 && parts[0] === '+') {
                    uniqueHashes.add(parts[1]);
                    // Add short hash as well for robustness
                    uniqueHashes.add(parts[1].substring(0, 7));
                }
            });
            return uniqueHashes;
        } catch (error) {
            console.error('[ReleaseService] getUniqueHashesByContent failed:', error);
            return new Set();
        }
    }

    public async hasCodeChanges(hash: string): Promise<boolean> {
        if (!this.isValidCommitHash(hash)) {
            return false;
        }
        try {
            const output = await this.execGit(['show', hash, '--format=', '--patch', '--stat']);
            return output.trim().length > 0;
        } catch (error) {
            console.error('[ReleaseService] hasCodeChanges failed:', error);
            return false;
        }
    }

    public async analyzeDependencyRisks(selectedHashes: string[], targetBranch: string, sourceBranch: string): Promise<DependencyRisk[]> {
        if (!selectedHashes.every(h => this.isValidCommitHash(h)) || !this.isValidBranchName(targetBranch) || !this.isValidBranchName(sourceBranch)) {
            console.error('[ReleaseService] Invalid inputs provided to analyzeDependencyRisks');
            return [];
        }
        const rawCommits = await this.getCommits(sourceBranch);
        const uniqueHashesSet = await this.getUniqueHashesByContent(targetBranch, sourceBranch);

        let allCandidates = rawCommits.filter(c => uniqueHashesSet.has(c.hash));
        allCandidates.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const selectedSet = new Set(selectedHashes);
        const skippedFileMap = new Map<string, { hash: string; msg: string; date: string }>();
        const risks: DependencyRisk[] = [];

        for (const commit of allCandidates) {
            const files = await this.getCommitFiles(commit.hash);

            if (!selectedSet.has(commit.hash)) {
                files.forEach(file => {
                    skippedFileMap.set(file, {
                        hash: commit.hash,
                        msg: commit.message,
                        date: commit.date
                    });
                });
            } else {
                for (const file of files) {
                    if (skippedFileMap.has(file)) {
                        const conflict = skippedFileMap.get(file)!;
                        risks.push({
                            type: 'dependency_warning',
                            file: file,
                            pickedCommit: commit.hash,
                            skippedCommit: conflict.hash,
                            skippedMessage: conflict.msg,
                            severity: 'high'
                        });
                    }
                }
            }
        }

        return risks;
    }

    public async getSpecificFilesDiff(hash: string, targetBranch: string, fileList: string[]): Promise<string> {
        if (!this.isValidCommitHash(hash) || !this.isValidBranchName(targetBranch)) {
            console.error('[ReleaseService] Invalid inputs provided to getSpecificFilesDiff');
            return '';
        }
        // Validate file paths don't contain path traversal
        const validFilePattern = /^[\w\-\/\.]+$/;
        const validFiles = fileList.filter(f => validFilePattern.test(f) && !f.includes('..'));
        try {
            if (!validFiles || validFiles.length === 0) {return '';}
            const args = ['diff', targetBranch, hash, '--', ...validFiles];
            return await this.execGit(args);
        } catch (error) {
            return '';
        }
    }

    public async processUniqueCommits(commits: Commit[], targetBranch: string): Promise<Commit[]> {
        console.log(`[ReleaseService] Processing ${commits.length} commits for webview...`);
        const sortedCommits = [...commits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const processed: Commit[] = [];

        for (const commit of sortedCommits) {
            if (!this.isValidCommitHash(commit.hash)) {
                console.error(`[ReleaseService] Skipping invalid commit hash: ${commit.hash}`);
                continue;
            }
            try {
                const commitBody = await this.execGit(['show', '-s', '--format=%B', commit.hash]);
                const workItemMatch = commitBody.match(/#(\d+)/);
                const touchedFiles = await this.getCommitFiles(commit.hash);

                // Bulk three-way classification: 2 git calls instead of 2×N
                const { pendingFiles, divergedFiles, obsoleteFiles } = await this.classifyFilesForCherryPick(commit.hash, targetBranch, touchedFiles);

                // Net diff: simulate cherry-pick via merge-tree, show only lines not yet on target
                let diff = pendingFiles.length > 0 ? await this.getNetCommitDiff(commit.hash, targetBranch, pendingFiles) : '';

                const allDeduped = touchedFiles.length > 0 && pendingFiles.length === 0 && obsoleteFiles.length === 0;
                const allObsoleteOrDeduped = touchedFiles.length > 0 && pendingFiles.length === 0 && obsoleteFiles.length > 0;

                processed.push({
                    ...commit,
                    diff: diff,
                    isOverridden: allDeduped,
                    isObsolete: allObsoleteOrDeduped,
                    workItemNumber: workItemMatch ? workItemMatch[1] : null,
                    divergedFiles: divergedFiles.length > 0 ? divergedFiles : undefined,
                    obsoleteFiles: obsoleteFiles.length > 0 ? obsoleteFiles : undefined,
                });
            } catch (e) {
                console.error(`[ReleaseService] Error processing commit ${commit.hash}:`, e);
                processed.push(commit);
            }
        }
        console.log(`[ReleaseService] Finished processing ${processed.length} commits`);
        return processed;
    }

    /**
     * Bulk three-way file classification using --name-only to avoid N+1 process spawning.
     * Only 2 git diff calls regardless of the number of files touched.
     */
    private async classifyFilesForCherryPick(hash: string, targetBranch: string, files: string[]): Promise<{ pendingFiles: string[]; divergedFiles: string[]; obsoleteFiles: string[] }> {
        if (files.length === 0) {
            return { pendingFiles: [], divergedFiles: [], obsoleteFiles: [] };
        }

        let tmpIndexPath: string | undefined;

        try {
            const diffVsCommitOutput = await this.execGit(['diff', '--name-only', targetBranch, hash]);
            const allDiffsVsCommit = new Set(diffVsCommitOutput.trim().split('\n').filter(Boolean));
            const differsFromCommit = new Set(files.filter(f => allDiffsVsCommit.has(f)));

            const notDeduped = files.filter(f => differsFromCommit.has(f));
            if (notDeduped.length === 0) {
                return { pendingFiles: [], divergedFiles: [], obsoleteFiles: [] };
            }

            const diffVsParentOutput = await this.execGit(['diff', '--name-only', targetBranch, `${hash}^`]);
            const allDiffsVsParent = new Set(diffVsParentOutput.trim().split('\n').filter(Boolean));
            const differsFromParent = new Set(notDeduped.filter(f => allDiffsVsParent.has(f)));

            const pendingFiles: string[] = [];
            const divergedFiles: string[] = [];
            const obsoleteFiles: string[] = [];

            // Build temp index once for all diverged files
            const hasDiverged = notDeduped.some(f => differsFromParent.has(f));
            if (hasDiverged) {
                tmpIndexPath = path.join(os.tmpdir(), `vscode-release-index-${hash.substring(0, 8)}-${Date.now()}`);
                await this.execGitWithOptions(['read-tree', targetBranch], { env: { GIT_INDEX_FILE: tmpIndexPath } });
            }

            for (const file of notDeduped) {
                if (differsFromParent.has(file) && tmpIndexPath) {
                    const obsolete = await this.checkHunkObsolescence(hash, tmpIndexPath, file);
                    if (obsolete) {
                        obsoleteFiles.push(file);
                        console.log(`[ReleaseService] File ${file} is obsolete: commit's changes already on target`);
                    } else {
                        pendingFiles.push(file);
                        divergedFiles.push(file);
                    }
                } else {
                    pendingFiles.push(file);
                }
            }
            return { pendingFiles, divergedFiles, obsoleteFiles };
        } catch {
            return { pendingFiles: [...files], divergedFiles: [], obsoleteFiles: [] };
        } finally {
            if (tmpIndexPath) {
                try { fs.unlinkSync(tmpIndexPath); } catch { /* cleanup best-effort */ }
            }
        }
    }

    /** Check if a diverged file's changes are already present on target using git's own patch machinery. */
    private async checkHunkObsolescence(hash: string, tmpIndexPath: string, file: string): Promise<boolean> {
        try {
            const patch = await this.execGit(['show', hash, '--format=', '--patch', '--', file]);
            if (!patch.trim()) {
                return true;
            }

            // Reverse-apply: if un-applying succeeds against target, the forward changes are already present
            await this.execGitWithOptions(
                ['apply', '--check', '--cached', '--reverse'],
                { env: { GIT_INDEX_FILE: tmpIndexPath }, stdinData: patch }
            );
            return true;
        } catch {
            // Non-zero exit is the normal path for genuinely-needed commits
            return false;
        }
    }

    /** Get the commit's own introduced changes (what cherry-pick applies) */
    public async getCommitOwnDiff(hash: string, fileList?: string[]): Promise<string> {
        if (!this.isValidCommitHash(hash)) {
            return '';
        }
        try {
            const args = ['show', hash, '--format=', '--patch'];
            if (fileList && fileList.length > 0) {
                const validFilePattern = /^[\w\-\/\.]+$/;
                const validFiles = fileList.filter(f => validFilePattern.test(f) && !f.includes('..'));
                if (validFiles.length > 0) {
                    args.push('--', ...validFiles);
                }
            }
            return await this.execGit(args);
        } catch {
            return '';
        }
    }

    /** Simulate cherry-pick via merge-tree; return only net-new changes vs target branch. */
    public async getNetCommitDiff(hash: string, targetBranch: string, fileList?: string[]): Promise<string> {
        if (!this.isValidCommitHash(hash) || !this.isValidBranchName(targetBranch)) {
            return '';
        }

        const validFiles = fileList ? fileList.filter(f => !f.includes('..')) : [];

        try {
            // Virtual merge: simulate cherry-pick entirely in memory (requires Git 2.38+)
            const treeOutput = await this.execGitWithOptions(
                ['merge-tree', '--write-tree', `--merge-base=${hash}^`, targetBranch, hash],
                { acceptExitCodes: [0, 1] }
            );

            const simulatedTreeId = treeOutput.split('\n')[0].trim();
            if (!simulatedTreeId) {
                throw new Error('merge-tree returned empty tree OID');
            }

            // Subtraction: diff target against simulated result — already-applied code cancels out
            const diffArgs = ['diff', targetBranch, simulatedTreeId, '--'];
            if (validFiles.length > 0) {
                diffArgs.push(...validFiles);
            }
            return await this.execGit(diffArgs);
        } catch (error) {
            // Fallback for Git < 2.38 or unexpected errors
            console.warn(`[ReleaseService] Net diff fallback for ${hash.substring(0, 7)}:`, error);
            const fallbackArgs = ['show', hash, '--format=', '--patch'];
            if (validFiles.length > 0) {
                fallbackArgs.push('--', ...validFiles);
            }
            return await this.execGit(fallbackArgs).catch(() => '');
        }
    }

    public async executeCherryPick(newBranchName: string, selectedHashes: string[], baseBranch: string): Promise<CherryPickResult> {
        if (!this.isValidBranchName(newBranchName) || !this.isValidBranchName(baseBranch)) {
            return { success: false, message: 'Invalid branch name format' };
        }
        if (!selectedHashes.every(h => this.isValidCommitHash(h))) {
            return { success: false, message: 'Invalid commit hash format' };
        }
        try {
            await this.execGit(['fetch', 'origin', baseBranch]);
            try {
                await this.execGit(['checkout', '-b', newBranchName, `origin/${baseBranch}`]);
            } catch (e: unknown) {
                throw new Error(`Branch ${newBranchName} creation failed. It might already exist.`);
            }

            return await this.performCherryPicks(selectedHashes, newBranchName, baseBranch);
        } catch (error: unknown) {
            console.error('[ReleaseService] executeCherryPick failed:', error);
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    public async appendToRelease(branchName: string, newHashes: string[], baseBranch: string): Promise<CherryPickResult> {
        if (!this.isValidBranchName(branchName) || !this.isValidBranchName(baseBranch)) {
            return { success: false, message: 'Invalid branch name format' };
        }
        if (!newHashes.every(h => this.isValidCommitHash(h))) {
            return { success: false, message: 'Invalid commit hash format' };
        }
        try {
            await this.execGit(['checkout', branchName]);
            return await this.performCherryPicks(newHashes, branchName, baseBranch, true);
        } catch (error: unknown) {
            console.error('[ReleaseService] appendToRelease failed:', error);
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    private async performCherryPicks(hashes: string[], branchName: string, baseBranch: string, isAppending: boolean = false): Promise<CherryPickResult> {
        return this.performCherryPicksFromState({
            hashes,
            branchName,
            baseBranch,
            isAppending,
            completedBefore: 0,
            startIndex: 0,
            selectedHashes: hashes,
            totalCommits: hashes.length
        });
    }

    private async performCherryPicksFromState(options: {
        hashes: string[];
        branchName: string;
        baseBranch: string;
        isAppending: boolean;
        completedBefore: number;
        startIndex: number;
        selectedHashes: string[];
        totalCommits: number;
    }): Promise<CherryPickResult> {
        let successCount = 0;

        for (let i = 0; i < options.hashes.length; i++) {
            const hash = options.hashes[i];
            const currentHashIndex = options.startIndex + i + 1;
            try {
                await this.execGit(['cherry-pick', hash]);
                successCount++;
            } catch (err: unknown) {
                const errorOutput = err instanceof Error ? err.message : String(err);
                
                if (errorOutput.includes('CONFLICT') ||
                    errorOutput.includes('Automatic merge failed') ||
                    errorOutput.includes('could not apply') ||
                    errorOutput.includes('fix conflicts and then run "git cherry-pick --continue"')) {
                    
                    const conflictingFiles = await this.getConflictingFiles();
                    if (conflictingFiles.length === 0) {
                        await this.execGit(['cherry-pick', '--abort']);
                        throw new Error(`Conflict at commit ${hash.substring(0, 7)} but no conflicting files found. Process stopped.`);
                    }

                    const fileContents: Record<string, string> = {};
                    for (const file of conflictingFiles) {
                        fileContents[file] = await this.getConflictContent(file);
                    }

                    const conflictState: ConflictState = {
                        state: 'CHERRY_PICK_CONFLICT',
                        branchName: options.branchName,
                        baseBranch: options.baseBranch,
                        totalCommits: options.totalCommits,
                        completedCommits: options.completedBefore + successCount,
                        remainingCommits: options.totalCommits - currentHashIndex,
                        currentCommit: hash,
                        currentCommitIndex: currentHashIndex,
                        selectedHashes: options.selectedHashes,
                        conflictingFiles: conflictingFiles,
                        fileContents: fileContents,
                        isAppending: options.isAppending,
                        timestamp: new Date().toISOString()
                    };
                    
                    return { 
                        success: false, 
                        requiresConflictResolution: true,
                        conflictState: conflictState,
                        message: `Conflict detected at commit ${hash.substring(0, 7)}. ${conflictingFiles.length} file(s) need resolution.`
                    };
                } else {
                    await this.execGit(['cherry-pick', '--abort']);
                    throw new Error(`Error at commit ${hash.substring(0, 7)}: ${errorOutput}`);
                }
            }
        }

        const totalSuccessCount = options.completedBefore + successCount;
        return {
            success: true,
            message: `${options.isAppending ? 'Appended' : 'Created branch with'} ${totalSuccessCount} commits.`
        };
    }

    public async resolveConflictFile(conflictState: ConflictState, filename: string, resolvedContent: string): Promise<CherryPickResult> {
        if (!conflictState || conflictState.state !== 'CHERRY_PICK_CONFLICT') {
            return { success: false, message: 'No active cherry-pick conflict state.' };
        }

        const resolvedPath = path.resolve(this.workspaceRoot, filename);
        if (!resolvedPath.startsWith(path.resolve(this.workspaceRoot))) {
            return { success: false, message: 'Invalid conflict file path.' };
        }

        try {
            await fs.promises.writeFile(resolvedPath, resolvedContent, 'utf-8');
            await this.execGit(['add', filename]);

            const remainingConflicts = await this.getConflictingFiles();
            if (remainingConflicts.length > 0) {
                const fileContents: Record<string, string> = {};
                for (const file of remainingConflicts) {
                    fileContents[file] = await this.getConflictContent(file);
                }

                return {
                    success: false,
                    requiresConflictResolution: true,
                    conflictState: {
                        ...conflictState,
                        conflictingFiles: remainingConflicts,
                        fileContents,
                        timestamp: new Date().toISOString()
                    },
                    message: `${remainingConflicts.length} conflict file(s) still need resolution.`
                };
            }

            await this.execGit(['cherry-pick', '--continue']);

            const remainingHashes = conflictState.selectedHashes.slice(conflictState.currentCommitIndex);
            if (remainingHashes.length === 0) {
                return {
                    success: true,
                    message: `${conflictState.isAppending ? 'Appended' : 'Created branch with'} ${conflictState.selectedHashes.length} commits.`
                };
            }

            return await this.performCherryPicksFromState({
                hashes: remainingHashes,
                branchName: conflictState.branchName,
                baseBranch: conflictState.baseBranch,
                isAppending: conflictState.isAppending,
                completedBefore: conflictState.currentCommitIndex,
                startIndex: conflictState.currentCommitIndex,
                selectedHashes: conflictState.selectedHashes,
                totalCommits: conflictState.totalCommits
            });
        } catch (error: unknown) {
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    public async abortCherryPick(): Promise<CherryPickResult> {
        try {
            await this.execGit(['cherry-pick', '--abort']);
            return { success: true, message: 'Cherry-pick aborted successfully.' };
        } catch (error: unknown) {
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    public async getBranchCommitMessages(branch: string): Promise<Set<string>> {
        try {
            const output = await this.execGit(['log', branch, '--pretty=tformat:%s']);
            return new Set(output.trim().split('\n').map(s => s.trim()).filter(Boolean));
        } catch (error) {
            return new Set();
        }
    }

    public async getCommitBody(hash: string): Promise<string> {
        if (!this.isValidCommitHash(hash)) {
            console.error('[ReleaseService] Invalid commit hash provided to getCommitBody');
            return '';
        }
        return await this.execGit(['show', '-s', '--format=%B', hash]);
    }

    public async getPRDiff(source: string, target: string): Promise<string> {
        if (!this.isValidBranchName(source) || !this.isValidBranchName(target)) {
            return 'Error: Invalid branch name format';
        }
        try {
            await this.execGit(['fetch', 'origin', source, target]);
            return await this.execGit(['diff', `origin/${target}...origin/${source}`]);
        } catch (error) {
            return `Error fetching diff: ${error}`;
        }
    }

    public async simulateCherryPicks(hashes: string[], targetBranch: string): Promise<CherryPickSimulationResult> {
        if (!hashes.every(h => this.isValidCommitHash(h)) || !this.isValidBranchName(targetBranch)) {
            return { success: false, message: 'Invalid commit hash or branch name format', totalSimulated: 0 };
        }
        if (hashes.length === 0) {
            return { success: false, message: 'No commits to simulate', totalSimulated: 0 };
        }

        let currentBase = targetBranch.startsWith('origin/') ? targetBranch : `origin/${targetBranch}`;

        for (let i = 0; i < hashes.length; i++) {
            const hash = hashes[i];
            try {
                const output = await this.execGitWithOptions(
                    ['merge-tree', '--write-tree', '--merge-base', `${hash}^`, currentBase, hash],
                    { acceptExitCodes: [0, 1] }
                );

                const lines = output.trim().split('\n');
                const treeOid = lines[0].trim();
                const conflictLines = lines.filter(l => l.startsWith('CONFLICT'));

                if (conflictLines.length > 0) {
                    const conflictingFiles = this.parseSimulationConflicts(conflictLines);
                    // Try to extract conflict content from the merged tree
                    for (const cf of conflictingFiles) {
                        try {
                            cf.content = await this.execGit(['show', `${treeOid}:${cf.file}`]);
                        } catch { /* file might not exist in tree */ }
                    }
                    return {
                        success: false,
                        message: `Conflict at commit ${hash.substring(0, 7)} (${i + 1} of ${hashes.length}). ${conflictingFiles.length} file(s) conflict.`,
                        conflictAtCommit: hash,
                        conflictAtIndex: i + 1,
                        conflictingFiles,
                        totalSimulated: i
                    };
                }

                if (!treeOid) {
                    return { success: false, message: `merge-tree returned empty tree for ${hash.substring(0, 7)}`, totalSimulated: i };
                }

                // Create a temporary commit object for chaining the next simulation
                const commitOid = (await this.execGit(['commit-tree', treeOid, '-m', 'sim', '-p', currentBase])).trim();
                currentBase = commitOid;
            } catch (error) {
                return {
                    success: false,
                    message: `Simulation failed at commit ${hash.substring(0, 7)}: ${error instanceof Error ? error.message : String(error)}`,
                    totalSimulated: i
                };
            }
        }

        return {
            success: true,
            message: `All ${hashes.length} commit(s) can be cherry-picked cleanly.`,
            totalSimulated: hashes.length
        };
    }

    private parseSimulationConflicts(lines: string[]): SimulationConflictFile[] {
        const results: SimulationConflictFile[] = [];
        for (const line of lines) {
            const typeMatch = line.match(/^CONFLICT \(([^)]+)\)/);
            const fileMatch = line.match(/(?:Merge conflict in |deleted in .+ and modified in .+ )(.+)$/) ||
                              line.match(/CONFLICT \([^)]+\): (.+?) deleted in/);
            const conflictType = typeMatch ? typeMatch[1] : 'unknown';
            const file = fileMatch ? fileMatch[1].trim() : undefined;
            if (file) {
                results.push({ file, conflictType });
            }
        }
        return results;
    }

    private async getConflictingFiles(): Promise<string[]> {
        try {
            const output = await this.execGit(['diff', '--name-only', '--diff-filter=U']);
            return output.trim().split('\n').filter(Boolean);
        } catch (error) {
            return [];
        }
    }

    private async getConflictContent(file: string): Promise<string> {
        try {
            const resolvedPath = path.resolve(this.workspaceRoot, file);
            if (!resolvedPath.startsWith(path.resolve(this.workspaceRoot))) {
                return 'Error: Invalid file path';
            }
            return await fs.promises.readFile(resolvedPath, 'utf-8');
        } catch (error) {
            return `Error reading file: ${error}`;
        }
    }
}
