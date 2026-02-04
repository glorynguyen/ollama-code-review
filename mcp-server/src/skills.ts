/**
 * Skills service for fetching and caching agent skills from GitHub
 * Ported from the VS Code extension
 */

import { Octokit } from '@octokit/rest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface AgentSkill {
  name: string;
  description: string;
  content: string;
  repository: string;
  path: string;
  downloadedAt?: number;
}

interface SkillMetadata {
  name?: string;
  description?: string;
}

interface GitHubContentResponse {
  type: string;
  name: string;
  path: string;
  content?: string;
  encoding?: string;
}

export class SkillsService {
  private octokit: Octokit;
  private cacheDir: string;
  private availableSkillsCache: Map<string, AgentSkill[]> = new Map();
  private downloadedSkillsCache: Map<string, AgentSkill> = new Map();

  constructor(cacheDir: string, githubToken?: string) {
    this.cacheDir = cacheDir;
    this.octokit = new Octokit({
      auth: githubToken,
    });
  }

  /**
   * Initialize the cache directory and load cached skills
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await this.loadCachedSkills();
  }

  /**
   * Load previously downloaded skills from disk
   */
  private async loadCachedSkills(): Promise<void> {
    try {
      const indexPath = path.join(this.cacheDir, 'index.json');
      const indexData = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexData) as Record<string, AgentSkill>;

      for (const [key, skill] of Object.entries(index)) {
        this.downloadedSkillsCache.set(key, skill);
      }
    } catch {
      // No cache file yet, that's fine
    }
  }

  /**
   * Save the skills index to disk
   */
  private async saveCacheIndex(): Promise<void> {
    const indexPath = path.join(this.cacheDir, 'index.json');
    const index = Object.fromEntries(this.downloadedSkillsCache.entries());
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * Parse YAML frontmatter from skill content
   */
  private parseSkillMetadata(content: string): { metadata: SkillMetadata; body: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (match) {
      try {
        const metadata = yaml.load(match[1]) as SkillMetadata;
        return { metadata, body: match[2].trim() };
      } catch {
        return { metadata: {}, body: content };
      }
    }

    return { metadata: {}, body: content };
  }

  /**
   * Fetch available skills from a single GitHub repository
   */
  async fetchSkillsFromRepo(repoFullName: string): Promise<AgentSkill[]> {
    const [owner, repo] = repoFullName.split('/');

    if (!owner || !repo) {
      throw new Error(`Invalid repository format: ${repoFullName}. Expected: owner/repo`);
    }

    try {
      // Get the skills directory contents
      const { data: skillsDirContents } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: 'skills',
      });

      if (!Array.isArray(skillsDirContents)) {
        throw new Error('Skills directory not found or not a directory');
      }

      const skills: AgentSkill[] = [];

      // Fetch each skill's SKILL.md
      for (const item of skillsDirContents) {
        if (item.type !== 'dir') continue;

        try {
          const { data: skillFile } = await this.octokit.repos.getContent({
            owner,
            repo,
            path: `${item.path}/SKILL.md`,
          });

          if ('content' in skillFile && skillFile.content) {
            const content = Buffer.from(skillFile.content, 'base64').toString('utf-8');
            const { metadata, body } = this.parseSkillMetadata(content);

            skills.push({
              name: metadata.name || item.name,
              description: metadata.description || `Skill from ${item.name}`,
              content: body,
              repository: repoFullName,
              path: item.path,
            });
          }
        } catch {
          // Skip skills that can't be fetched
          console.error(`Failed to fetch skill: ${item.path}`);
        }
      }

      return skills;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for rate limiting
      if (errorMessage.includes('403') || errorMessage.includes('rate limit')) {
        throw new Error(
          `GitHub API rate limit exceeded. Please try again later or provide a GitHub token.`
        );
      }

      throw new Error(`Failed to fetch skills from ${repoFullName}: ${errorMessage}`);
    }
  }

  /**
   * Fetch skills from multiple repositories
   */
  async fetchSkillsFromAllRepos(repositories: string[]): Promise<AgentSkill[]> {
    const results = await Promise.allSettled(
      repositories.map((repo) => this.fetchSkillsFromRepo(repo))
    );

    const allSkills: AgentSkill[] = [];
    const errors: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        allSkills.push(...result.value);
        // Cache available skills by repo
        this.availableSkillsCache.set(repositories[i], result.value);
      } else {
        errors.push(`${repositories[i]}: ${result.reason.message}`);
      }
    }

    if (errors.length > 0 && allSkills.length === 0) {
      throw new Error(`Failed to fetch skills:\n${errors.join('\n')}`);
    }

    return allSkills;
  }

  /**
   * Download and cache a skill locally
   */
  async downloadSkill(skill: AgentSkill): Promise<AgentSkill> {
    const repoDir = skill.repository.replace('/', '__');
    const skillDir = path.join(this.cacheDir, repoDir, skill.name);

    await fs.mkdir(skillDir, { recursive: true });

    const skillPath = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(skillPath, skill.content);

    const downloadedSkill: AgentSkill = {
      ...skill,
      downloadedAt: Date.now(),
    };

    const cacheKey = `${skill.repository}/${skill.name}`;
    this.downloadedSkillsCache.set(cacheKey, downloadedSkill);
    await this.saveCacheIndex();

    return downloadedSkill;
  }

  /**
   * Get a cached skill by name and repository
   */
  getCachedSkill(skillName: string, repository?: string): AgentSkill | undefined {
    if (repository) {
      return this.downloadedSkillsCache.get(`${repository}/${skillName}`);
    }

    // Search all cached skills
    for (const [key, skill] of this.downloadedSkillsCache) {
      if (skill.name === skillName) {
        return skill;
      }
    }

    return undefined;
  }

  /**
   * Get all downloaded skills
   */
  getDownloadedSkills(): AgentSkill[] {
    return Array.from(this.downloadedSkillsCache.values());
  }

  /**
   * Get available skills (from last fetch)
   */
  getAvailableSkills(repository?: string): AgentSkill[] {
    if (repository) {
      return this.availableSkillsCache.get(repository) || [];
    }

    const allSkills: AgentSkill[] = [];
    for (const skills of this.availableSkillsCache.values()) {
      allSkills.push(...skills);
    }
    return allSkills;
  }

  /**
   * Delete a cached skill
   */
  async deleteSkill(skillName: string, repository: string): Promise<void> {
    const cacheKey = `${repository}/${skillName}`;
    this.downloadedSkillsCache.delete(cacheKey);

    const repoDir = repository.replace('/', '__');
    const skillDir = path.join(this.cacheDir, repoDir, skillName);

    try {
      await fs.rm(skillDir, { recursive: true });
    } catch {
      // Directory might not exist
    }

    await this.saveCacheIndex();
  }
}
