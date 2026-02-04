/**
 * Git operations module
 * Provides git diff extraction and repository operations
 */

import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface DiffResult {
  diff: string;
  files: string[];
  stats: {
    insertions: number;
    deletions: number;
    filesChanged: number;
  };
}

export class GitService {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;

    const options: Partial<SimpleGitOptions> = {
      baseDir: repoPath,
      binary: 'git',
      maxConcurrentProcesses: 6,
      trimmed: false,
    };

    this.git = simpleGit(options);
  }

  /**
   * Check if the path is a valid git repository
   */
  async isValidRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the repository root path
   */
  async getRepoRoot(): Promise<string> {
    const root = await this.git.revparse(['--show-toplevel']);
    return root.trim();
  }

  /**
   * Get staged changes diff
   */
  async getStagedDiff(): Promise<DiffResult> {
    const diff = await this.git.diff(['--staged']);
    const diffStat = await this.git.diff(['--staged', '--stat']);
    const files = await this.git.diff(['--staged', '--name-only']);

    return {
      diff,
      files: files.trim().split('\n').filter(Boolean),
      stats: this.parseDiffStats(diffStat),
    };
  }

  /**
   * Get unstaged changes diff
   */
  async getUnstagedDiff(): Promise<DiffResult> {
    const diff = await this.git.diff();
    const diffStat = await this.git.diff(['--stat']);
    const files = await this.git.diff(['--name-only']);

    return {
      diff,
      files: files.trim().split('\n').filter(Boolean),
      stats: this.parseDiffStats(diffStat),
    };
  }

  /**
   * Get all changes (staged + unstaged)
   */
  async getAllChangesDiff(): Promise<DiffResult> {
    const diff = await this.git.diff(['HEAD']);
    const diffStat = await this.git.diff(['HEAD', '--stat']);
    const files = await this.git.diff(['HEAD', '--name-only']);

    return {
      diff,
      files: files.trim().split('\n').filter(Boolean),
      stats: this.parseDiffStats(diffStat),
    };
  }

  /**
   * Get diff for a specific commit
   */
  async getCommitDiff(commitHash: string): Promise<DiffResult> {
    // For the initial commit, diff against empty tree
    const isInitialCommit = await this.isInitialCommit(commitHash);
    const parent = isInitialCommit
      ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // Empty tree hash
      : `${commitHash}^`;

    const diff = await this.git.diff([parent, commitHash]);
    const diffStat = await this.git.diff([parent, commitHash, '--stat']);
    const files = await this.git.diff([parent, commitHash, '--name-only']);

    return {
      diff,
      files: files.trim().split('\n').filter(Boolean),
      stats: this.parseDiffStats(diffStat),
    };
  }

  /**
   * Get diff between two commits
   */
  async getCommitRangeDiff(fromCommit: string, toCommit: string): Promise<DiffResult> {
    const diff = await this.git.diff([fromCommit, toCommit]);
    const diffStat = await this.git.diff([fromCommit, toCommit, '--stat']);
    const files = await this.git.diff([fromCommit, toCommit, '--name-only']);

    return {
      diff,
      files: files.trim().split('\n').filter(Boolean),
      stats: this.parseDiffStats(diffStat),
    };
  }

  /**
   * Get diff between two branches
   */
  async getBranchDiff(baseBranch: string, targetBranch: string): Promise<DiffResult> {
    const diff = await this.git.diff([baseBranch, targetBranch]);
    const diffStat = await this.git.diff([baseBranch, targetBranch, '--stat']);
    const files = await this.git.diff([baseBranch, targetBranch, '--name-only']);

    return {
      diff,
      files: files.trim().split('\n').filter(Boolean),
      stats: this.parseDiffStats(diffStat),
    };
  }

  /**
   * Get recent commits
   */
  async getRecentCommits(limit: number = 10): Promise<GitCommit[]> {
    const log = await this.git.log({ maxCount: limit });

    return log.all.map((commit) => ({
      hash: commit.hash,
      message: commit.message,
      author: commit.author_name,
      date: commit.date,
    }));
  }

  /**
   * Get all branches
   */
  async getBranches(): Promise<{ current: string; all: string[] }> {
    const branches = await this.git.branch();
    return {
      current: branches.current,
      all: branches.all,
    };
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    const branches = await this.git.branch();
    return branches.current;
  }

  /**
   * Check if a commit is the initial commit (has no parent)
   */
  private async isInitialCommit(commitHash: string): Promise<boolean> {
    try {
      await this.git.raw(['rev-parse', `${commitHash}^`]);
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Parse diff stats output
   */
  private parseDiffStats(statOutput: string): {
    insertions: number;
    deletions: number;
    filesChanged: number;
  } {
    const lines = statOutput.trim().split('\n');
    const summaryLine = lines[lines.length - 1] || '';

    // Match patterns like "3 files changed, 45 insertions(+), 12 deletions(-)"
    const filesMatch = summaryLine.match(/(\d+) files? changed/);
    const insertionsMatch = summaryLine.match(/(\d+) insertions?\(\+\)/);
    const deletionsMatch = summaryLine.match(/(\d+) deletions?\(-\)/);

    return {
      filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      insertions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
      deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0,
    };
  }

  /**
   * Get status summary
   */
  async getStatus(): Promise<{
    staged: string[];
    unstaged: string[];
    untracked: string[];
  }> {
    const status = await this.git.status();

    return {
      staged: status.staged,
      unstaged: status.modified.filter((f) => !status.staged.includes(f)),
      untracked: status.not_added,
    };
  }
}

/**
 * Find git repositories in a directory
 */
export async function findGitRepos(searchPath: string): Promise<string[]> {
  const repos: string[] = [];

  async function searchDir(dir: string, depth: number = 0): Promise<void> {
    if (depth > 3) return; // Limit search depth

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.name === '.git') {
          repos.push(dir);
          return; // Don't search inside .git
        }

        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue; // Skip common non-repo directories
        }

        await searchDir(fullPath, depth + 1);
      }
    } catch {
      // Permission denied or other errors
    }
  }

  // Check if searchPath itself is a repo
  const git = simpleGit(searchPath);
  try {
    await git.status();
    repos.push(searchPath);
  } catch {
    await searchDir(searchPath);
  }

  return repos;
}
