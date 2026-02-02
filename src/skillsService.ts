// src/skillsService.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface AgentSkill {
    name: string;
    description: string;
    content: string;
    repository: string;
    path: string;
    downloadedAt?: number;
}

/**
 * Interface describing the subset of Octokit API methods we use.
 * This provides type safety without importing the ESM-only @octokit/rest types directly.
 */
interface OctokitInstance {
    repos: {
        getContent(params: {
            owner: string;
            repo: string;
            path: string;
        }): Promise<{
            data: Array<{ type: string; name: string }> | { content?: string };
        }>;
    };
}

export class SkillsService {
    // Using OctokitInstance interface for type safety with ESM-only @octokit/rest
    private octokit: OctokitInstance;
    private skillsCache: Map<string, AgentSkill> = new Map();  // Downloaded skills cache
    private availableSkillsCache: Map<string, AgentSkill> = new Map();  // Available skills from GitHub (in-memory only)
    private readonly DEFAULT_SKILLS_REPO = 'vercel-labs/agent-skills';
    private readonly CACHE_DIR: string;
    private readonly CACHE_INDEX_FILE: string;

    private constructor(private context: vscode.ExtensionContext, octokit: OctokitInstance) {
        this.octokit = octokit;
        this.CACHE_DIR = path.join(context.globalStorageUri.fsPath, 'agent-skills');
        this.CACHE_INDEX_FILE = path.join(this.CACHE_DIR, 'index.json');
        this.ensureCacheDirectory();
        this.loadCachedSkills();
    }

    static async create(context: vscode.ExtensionContext): Promise<SkillsService> {
        // Dynamic import required because @octokit/rest is an ESM-only module
        const { Octokit } = await import('@octokit/rest');
        const octokit = new Octokit();
        return new SkillsService(context, octokit as OctokitInstance);
    }


    private ensureCacheDirectory() {
        if (!fs.existsSync(this.CACHE_DIR)) {
            fs.mkdirSync(this.CACHE_DIR, { recursive: true });
        }
    }

    /**
     * Load all cached skills from disk into memory
     * This runs on extension activation
     */
    private loadCachedSkills() {
        try {
            if (fs.existsSync(this.CACHE_INDEX_FILE)) {
                const indexData = fs.readFileSync(this.CACHE_INDEX_FILE, 'utf-8');
                const cachedSkills: AgentSkill[] = JSON.parse(indexData);

                cachedSkills.forEach(skill => {
                    // Fallback to default repo for legacy cache entries without repository field
                    const repository = skill.repository || this.DEFAULT_SKILLS_REPO;
                    // Ensure skill has repository field set for consistency
                    skill.repository = repository;

                    // Use repository-qualified path (new format)
                    const repoDir = repository.replace('/', '__');
                    let skillFilePath = path.join(this.CACHE_DIR, repoDir, skill.name, 'SKILL.md');

                    // Also check legacy path for backwards compatibility
                    const legacySkillFilePath = path.join(this.CACHE_DIR, skill.name, 'SKILL.md');

                    if (fs.existsSync(skillFilePath)) {
                        // New format found
                        const cacheKey = `${repository}/${skill.name}`;
                        this.skillsCache.set(cacheKey, skill);
                    } else if (fs.existsSync(legacySkillFilePath)) {
                        // Migrate from legacy path to new format
                        const newSkillDir = path.join(this.CACHE_DIR, repoDir, skill.name);
                        try {
                            fs.mkdirSync(newSkillDir, { recursive: true });
                            fs.copyFileSync(legacySkillFilePath, path.join(newSkillDir, 'SKILL.md'));
                            // Remove legacy file after successful migration
                            fs.rmSync(path.join(this.CACHE_DIR, skill.name), { recursive: true, force: true });
                            console.log(`Migrated skill '${skill.name}' to repository-qualified path`);
                        } catch (migrationError) {
                            console.warn(`Failed to migrate skill '${skill.name}':`, migrationError);
                        }
                        const cacheKey = `${repository}/${skill.name}`;
                        this.skillsCache.set(cacheKey, skill);
                    }
                });

                console.log(`Loaded ${this.skillsCache.size} cached skills from disk`);
            }
        } catch (error) {
            console.error('Failed to load cached skills:', error);
            // If cache is corrupted, start fresh and notify user
            this.skillsCache.clear();
            vscode.window.showWarningMessage(
                'Skills cache was corrupted and has been cleared. Skills will be refetched on next browse.'
            );
        }
    }

    /**
     * Save the skills index to disk
     */
    private saveCacheIndex() {
        try {
            const skills = Array.from(this.skillsCache.values());
            fs.writeFileSync(
                this.CACHE_INDEX_FILE,
                JSON.stringify(skills, null, 2),
                'utf-8'
            );
        } catch (error) {
            console.error('Failed to save cache index:', error);
        }
    }

    /**
     * Fetches available skills from a single GitHub repository
     * @deprecated Use fetchAvailableSkillsFromAllRepos for multi-repo support
     */
    async fetchAvailableSkills(repo: string = this.DEFAULT_SKILLS_REPO, forceRefresh: boolean = false): Promise<AgentSkill[]> {
        if (!forceRefresh && this.skillsCache.size > 0) {
            // Filter by repository to avoid returning skills from all repos
            const filtered = Array.from(this.skillsCache.values())
                .filter(skill => skill.repository === repo);
            if (filtered.length > 0) {
                return filtered;
            }
        }

        const skills = await this.fetchSkillsFromRepo(repo);

        // Populate cache with fetched skills
        skills.forEach(skill => {
            const cacheKey = `${skill.repository}/${skill.name}`;
            this.skillsCache.set(cacheKey, skill);
        });

        if (skills.length > 0) {
            this.saveCacheIndex();
        }

        return skills;
    }

    private isValidRepoFormat(repo: string): boolean {
        const parts = repo.split('/');
        return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
    }

    /**
     * Formats error summary for user display
     */
    private formatErrorSummary(errors: string[]): string {
        // Check for common error types
        const isRateLimit = errors.some(e => e.toLowerCase().includes('rate limit'));
        const isNetwork = errors.some(e =>
            e.toLowerCase().includes('network') ||
            e.toLowerCase().includes('enotfound') ||
            e.toLowerCase().includes('econnrefused')
        );
        const isTimeout = errors.some(e => e.toLowerCase().includes('timeout'));

        if (isRateLimit) {
            return '⚠️ GitHub API rate limit exceeded. Please wait a few minutes before retrying.';
        }
        if (isNetwork) {
            return '⚠️ Network error: Unable to connect to GitHub. Please check your internet connection.';
        }
        if (isTimeout) {
            return '⚠️ Request timeout: GitHub is taking too long to respond.';
        }

        // Generic error with first error message
        return `⚠️ Error fetching skills: ${errors[0]}`;
    }

    /**
     * Parses GitHub API error to provide user-friendly message
     */
    private parseGitHubError(error: unknown): string {
        if (error && typeof error === 'object') {
            const err = error as { status?: number; message?: string; response?: { data?: { message?: string } } };

            // Check for rate limiting (status 403 or 429)
            if (err.status === 403 || err.status === 429) {
                const message = err.response?.data?.message || err.message || '';
                if (message.toLowerCase().includes('rate limit')) {
                    return 'GitHub API rate limit exceeded. Please wait a few minutes or configure a GitHub token.';
                }
                return `GitHub API access forbidden (403): ${message}`;
            }

            // Check for not found (status 404)
            if (err.status === 404) {
                return 'Repository or skills directory not found (404)';
            }

            // Check for network errors
            if (err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED')) {
                return 'Network error: Unable to connect to GitHub. Check your internet connection.';
            }

            // Check for timeout
            if (err.message?.includes('timeout')) {
                return 'Request timeout: GitHub is taking too long to respond.';
            }

            // Return the error message if available
            if (err.response?.data?.message) {
                return err.response.data.message;
            }
            if (err.message) {
                return err.message;
            }
        }

        return String(error);
    }

    /**
     * Fetches skills from a single repository
     */
    private async fetchSkillsFromRepo(repo: string): Promise<AgentSkill[]> {

        if (!this.isValidRepoFormat(repo)) {
            console.error(`Invalid repository format: ${repo}. Expected format: owner/repo`);
            throw new Error(`Invalid repository format: ${repo}. Expected format: owner/repo`);
        }
        const [owner, repoName] = repo.split('/');

        try {
            // Get the skills directory contents
            const { data: contents } = await this.octokit.repos.getContent({
                owner,
                repo: repoName,
                path: 'skills'
            });

            if (!Array.isArray(contents)) {
                console.warn(`Skills directory not found in ${repo}`);
                throw new Error(`Skills directory not found in repository`);
            }

            const skills: AgentSkill[] = [];

            // Iterate through each skill directory
            for (const item of contents) {
                if (item.type === 'dir') {
                    const skill = await this.fetchSkill(owner, repoName, `skills/${item.name}`);
                    if (skill) {
                        skills.push(skill);
                    }
                }
            }

            return skills;
        } catch (error) {
            const errorMessage = this.parseGitHubError(error);
            console.error(`Failed to fetch skills from ${repo}:`, errorMessage);
            throw new Error(errorMessage);
        }
    }

    /**
     * Fetches available skills from all configured repositories (default + additional)
     * @param forceRefresh If true, fetches from network even if in-memory cache exists
     */
    async fetchAvailableSkillsFromAllRepos(forceRefresh: boolean = false): Promise<AgentSkill[]> {
        // Use separate in-memory cache for available skills (not persisted to disk)
        // This is different from skillsCache which tracks downloaded skills
        if (!forceRefresh && this.availableSkillsCache.size > 0) {
            return Array.from(this.availableSkillsCache.values());
        }

        // Save old cache in case fetch fails - don't clear until we have new data
        const oldAvailableCache = new Map(this.availableSkillsCache);

        const config = vscode.workspace.getConfiguration('ollama-code-review');
        const defaultRepo = config.get<string>('skills.defaultRepository', this.DEFAULT_SKILLS_REPO);
        const additionalRepos = config.get<string[]>('skills.additionalRepositories', []);

        // Combine all repositories (default first, then additional)
        const allRepos = [defaultRepo, ...additionalRepos].filter(repo => repo && repo.trim());

        // Remove duplicates
        const uniqueRepos = [...new Set(allRepos)];

        const allSkills: AgentSkill[] = [];
        const errors: string[] = [];

        // Fetch from all repositories in parallel
        const results = await Promise.allSettled(
            uniqueRepos.map(repo => this.fetchSkillsFromRepo(repo))
        );

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                allSkills.push(...result.value);
            } else {
                const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
                errors.push(`${uniqueRepos[index]}: ${reason}`);
            }
        });

        if (errors.length > 0 && allSkills.length === 0) {
            // Determine if it's a rate limit error
            const isRateLimit = errors.some(e => e.toLowerCase().includes('rate limit'));
            const errorSummary = this.formatErrorSummary(errors);

            // All repos failed, try old available skills cache first, then downloaded skills cache
            if (oldAvailableCache.size > 0) {
                console.warn('Failed to fetch from all repositories, using cached available skills');
                vscode.window.showWarningMessage(
                    `${errorSummary}\n\nShowing ${oldAvailableCache.size} cached skills instead.`,
                    { modal: false }
                );
                return Array.from(oldAvailableCache.values());
            }
            if (this.skillsCache.size > 0) {
                console.warn('Failed to fetch from all repositories, using downloaded skills as fallback');
                vscode.window.showWarningMessage(
                    `${errorSummary}\n\nShowing ${this.skillsCache.size} downloaded skills only.`,
                    { modal: false }
                );
                return Array.from(this.skillsCache.values());
            }

            // No cache available - show detailed error
            const detailedError = isRateLimit
                ? 'GitHub API rate limit exceeded.\n\nTo fix this:\n• Wait a few minutes and try again\n• Or configure a GitHub personal access token'
                : `Failed to fetch skills:\n\n${errors.join('\n')}`;

            throw new Error(detailedError);
        }

        // Success - update the cache with new data
        if (forceRefresh) {
            this.availableSkillsCache.clear();
        }
        allSkills.forEach(skill => {
            const cacheKey = `${skill.repository}/${skill.name}`;
            this.availableSkillsCache.set(cacheKey, skill);
        });

        if (errors.length > 0) {
            const errorSummary = this.formatErrorSummary(errors);
            console.warn(`Some repositories failed to load:\n${errors.join('\n')}`);
            vscode.window.showWarningMessage(
                `${errorSummary}\n\n${allSkills.length} skills loaded successfully from other repositories.`
            );
        }

        return allSkills;
    }

    /** Fetches a specific skill from GitHub */
    private async fetchSkill(owner: string, repo: string, skillPath: string): Promise<AgentSkill | null> {
        try {
            // Get SKILL.md content
            const { data: skillFile } = await this.octokit.repos.getContent({
                owner,
                repo,
                path: `${skillPath}/SKILL.md`
            });

            if ('content' in skillFile && skillFile.content) {
                const content = Buffer.from(skillFile.content, 'base64').toString('utf-8');
                const metadata = this.parseSkillMetadata(content);

                return {
                    name: metadata.name || path.basename(skillPath),
                    description: metadata.description || '',
                    content: content,
                    repository: `${owner}/${repo}`,
                    path: skillPath
                };
            }

            return null;
        } catch (error) {
            console.error(`Failed to fetch skill at ${skillPath}:`, error);
            return null;
        }
    }

    /** Parses YAML frontmatter from SKILL.md */
    private parseSkillMetadata(content: string): { name?: string; description?: string } {
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/;
        const match = content.match(frontmatterRegex);

        if (match) {
            const yaml = match[1];
            const nameMatch = yaml.match(/name:\s*(.+)/);
            const descMatch = yaml.match(/description:\s*(.+)/);

            return {
                name: nameMatch?.[1]?.trim(),
                description: descMatch?.[1]?.trim()
            };
        }

        return {};
    }

    /**
     * Gets the repository-qualified directory path for a skill.
     * Converts 'owner/repo' to 'owner__repo' to avoid filesystem issues.
     */
    private getSkillDirectory(skill: AgentSkill): string {
        const repoDir = skill.repository.replace('/', '__');
        return path.join(this.CACHE_DIR, repoDir, skill.name);
    }

    /** Downloads and caches a skill locally */
    async downloadSkill(skill: AgentSkill): Promise<string> {
        // Use repository-qualified path to avoid collisions between repos with same skill names
        const skillDir = this.getSkillDirectory(skill);
        const skillFilePath = path.join(skillDir, 'SKILL.md');

        // Create skill directory
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        // Write SKILL.md
        fs.writeFileSync(skillFilePath, skill.content, 'utf-8');

        // Cache the skill with composite key to avoid cross-repo collisions
        const cacheKey = `${skill.repository}/${skill.name}`;
        this.skillsCache.set(cacheKey, skill);

        // Persist cache to disk
        this.saveCacheIndex();

        return skillFilePath;
    }

    /** Gets a cached skill by name or composite key (repo/name) */
    getCachedSkill(name: string): AgentSkill | undefined {
        // Try direct lookup first (for composite keys like "owner/repo/skillName")
        const direct = this.skillsCache.get(name);
        if (direct) {
            return direct;
        }

        // Fall back to searching by skill name for backwards compatibility
        for (const skill of this.skillsCache.values()) {
            if (skill.name === name) {
                return skill;
            }
        }

        return undefined;
    }

    /** Lists all cached skills */
    listCachedSkills(): AgentSkill[] {
        return Array.from(this.skillsCache.values());
    }

    /**
     * Checks if a skill is downloaded locally
     * @param skill The skill to check
     * @returns true if skill is downloaded
     */
    isSkillDownloaded(skill: AgentSkill): boolean {
        const cacheKey = `${skill.repository}/${skill.name}`;
        return this.skillsCache.has(cacheKey);
    }

    /**
     * Deletes a downloaded skill from local cache
     * @param skill The skill to delete
     * @returns true if deletion was successful
     */
    async deleteSkill(skill: AgentSkill): Promise<boolean> {
        const cacheKey = `${skill.repository}/${skill.name}`;
        // Use repository-qualified path
        const skillDir = this.getSkillDirectory(skill);

        try {
            // Remove from memory cache
            this.skillsCache.delete(cacheKey);

            // Remove skill directory from disk (new format)
            if (fs.existsSync(skillDir)) {
                fs.rmSync(skillDir, { recursive: true, force: true });
            }

            // Also clean up legacy path if it exists
            const legacySkillDir = path.join(this.CACHE_DIR, skill.name);
            if (fs.existsSync(legacySkillDir)) {
                fs.rmSync(legacySkillDir, { recursive: true, force: true });
            }

            // Update persisted cache index
            this.saveCacheIndex();

            console.log(`Deleted skill: ${skill.name} from ${skill.repository}`);
            return true;
        } catch (error) {
            console.error(`Failed to delete skill ${skill.name}:`, error);
            throw error;
        }
    }

    /**
     * Refetches a skill from GitHub to get the latest version
     * @param skill The skill to refetch
     * @returns The updated skill
     */
    async refetchSkill(skill: AgentSkill): Promise<AgentSkill> {
        const [owner, repoName] = skill.repository.split('/');

        try {
            // Fetch fresh content from GitHub
            const updatedSkill = await this.fetchSkill(owner, repoName, skill.path);

            if (!updatedSkill) {
                throw new Error(`Failed to fetch skill ${skill.name} from ${skill.repository}`);
            }

            // Update the downloadedAt timestamp
            updatedSkill.downloadedAt = Date.now();

            // Update the skill on disk using repository-qualified path
            const skillDir = this.getSkillDirectory(updatedSkill);
            const skillFilePath = path.join(skillDir, 'SKILL.md');

            if (!fs.existsSync(skillDir)) {
                fs.mkdirSync(skillDir, { recursive: true });
            }

            fs.writeFileSync(skillFilePath, updatedSkill.content, 'utf-8');

            // Update caches
            const cacheKey = `${updatedSkill.repository}/${updatedSkill.name}`;
            this.skillsCache.set(cacheKey, updatedSkill);
            this.availableSkillsCache.set(cacheKey, updatedSkill);

            // Persist cache to disk
            this.saveCacheIndex();

            console.log(`Refetched skill: ${skill.name} from ${skill.repository}`);
            return updatedSkill;
        } catch (error) {
            console.error(`Failed to refetch skill ${skill.name}:`, error);
            throw error;
        }
    }

    /**
     * Clears in-memory caches to free memory.
     * Called during extension deactivation.
     * Note: Downloaded skills cache (skillsCache) is persisted to disk,
     * so clearing it only frees memory without losing data.
     */
    dispose(): void {
        // Clear the in-memory available skills cache (not persisted to disk)
        this.availableSkillsCache.clear();
        // Optionally clear the downloaded skills cache from memory
        // (data is still persisted in index.json and will be reloaded on next activation)
        this.skillsCache.clear();
        console.log('SkillsService disposed: in-memory caches cleared');
    }

    /**
     * Clears only the in-memory available skills cache.
     * Useful for reducing memory usage without losing downloaded skills state.
     */
    clearAvailableSkillsCache(): void {
        this.availableSkillsCache.clear();
        console.log('Available skills cache cleared');
    }
}