import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface Commit {
    hash: string;
    message: string;
    author: string;
    email: string;
    date: string;
    diff?: string;
    isOverridden?: boolean;
    workItemNumber?: string | null;
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
        const seenFiles = new Set<string>();
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
                const effectiveFiles = touchedFiles.filter(file => !seenFiles.has(file));
                touchedFiles.forEach(file => seenFiles.add(file));
                
                // Diff relative to target branch for the effective files
                let diff = effectiveFiles.length > 0 ? await this.getSpecificFilesDiff(commit.hash, targetBranch, effectiveFiles) : '';
                
                processed.push({
                    ...commit,
                    diff: diff,
                    isOverridden: effectiveFiles.length === 0 && touchedFiles.length > 0,
                    workItemNumber: workItemMatch ? workItemMatch[1] : null
                });
            } catch (e) {
                console.error(`[ReleaseService] Error processing commit ${commit.hash}:`, e);
                processed.push(commit); // Push raw commit if processing fails
            }
        }
        console.log(`[ReleaseService] Finished processing ${processed.length} commits`);
        return processed;
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
                // If it fails, try checking out existing branch
                await this.execGit(['checkout', newBranchName]);
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
        let successCount = 0;
        let currentHashIndex = 0;

        for (const hash of hashes) {
            currentHashIndex++;
            try {
                await this.execGit(['cherry-pick', hash]);
                successCount++;
            } catch (err: unknown) {
                const errorOutput = err instanceof Error ? err.message : String(err);
                
                if (errorOutput.includes('CONFLICT') ||
                    errorOutput.includes('Automatic merge failed') ||
                    errorOutput.includes('could not apply')) {
                    
                    const conflictingFiles = await this.getConflictingFiles();
                    const fileContents: Record<string, string> = {};
                    for (const file of conflictingFiles) {
                        fileContents[file] = await this.getConflictContent(file);
                    }

                    const conflictState: ConflictState = {
                        state: 'CHERRY_PICK_CONFLICT',
                        branchName: branchName,
                        baseBranch: baseBranch,
                        totalCommits: hashes.length,
                        completedCommits: successCount,
                        remainingCommits: hashes.length - currentHashIndex,
                        currentCommit: hash,
                        currentCommitIndex: currentHashIndex,
                        selectedHashes: hashes,
                        conflictingFiles: conflictingFiles,
                        fileContents: fileContents,
                        isAppending: isAppending,
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

        return { success: true, message: `${isAppending ? 'Appended' : 'Created branch with'} ${successCount} commits.` };
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
            return await this.execGit(['diff', target, source]);
        } catch (error) {
            return `Error fetching diff: ${error}`;
        }
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
