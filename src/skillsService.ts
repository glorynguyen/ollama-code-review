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

export class SkillsService {
    private octokit: any;
    private skillsCache: Map<string, AgentSkill> = new Map();
    private readonly DEFAULT_SKILLS_REPO = 'vercel-labs/agent-skills';
    private readonly CACHE_DIR: string;
    private readonly CACHE_INDEX_FILE: string;

    private constructor(private context: vscode.ExtensionContext, octokit: any) {
        this.octokit = octokit;
        this.CACHE_DIR = path.join(context.globalStorageUri.fsPath, 'agent-skills');
        this.CACHE_INDEX_FILE = path.join(this.CACHE_DIR, 'index.json');
        this.ensureCacheDirectory();
        this.loadCachedSkills();
    }

    static async create(context: vscode.ExtensionContext): Promise<SkillsService> {
        const { Octokit } = await import('@octokit/rest');
        const octokit = new Octokit();
        return new SkillsService(context, octokit);
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
                    // Verify the skill file still exists
                    const skillFilePath = path.join(this.CACHE_DIR, skill.name, 'SKILL.md');
                    if (fs.existsSync(skillFilePath)) {
                        this.skillsCache.set(skill.name, skill);
                    }
                });
                
                console.log(`Loaded ${this.skillsCache.size} cached skills from disk`);
            }
        } catch (error) {
            console.error('Failed to load cached skills:', error);
            // If cache is corrupted, start fresh
            this.skillsCache.clear();
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

    /** Fetches available skills from a GitHub repository */
    async fetchAvailableSkills(repo: string = this.DEFAULT_SKILLS_REPO, forceRefresh: boolean = false): Promise<AgentSkill[]> {
        if (!forceRefresh && this.skillsCache.size > 0) {
            return Array.from(this.skillsCache.values());
        }
        try {
            const [owner, repoName] = repo.split('/');

            // Get the skills directory contents
            const { data: contents } = await this.octokit.repos.getContent({
                owner,
                repo: repoName,
                path: 'skills'
            });

            if (!Array.isArray(contents)) {
                throw new Error('Skills directory not found');
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
            if (this.skillsCache.size > 0) {
                console.warn('Failed to fetch from network, using cached skills');
                return Array.from(this.skillsCache.values());
            }
            throw new Error(`Failed to fetch skills: ${error}`);
        }
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

    /** Downloads and caches a skill locally */
    async downloadSkill(skill: AgentSkill): Promise<string> {
        const skillDir = path.join(this.CACHE_DIR, skill.name);
        const skillFilePath = path.join(skillDir, 'SKILL.md');

        // Create skill directory
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        // Write SKILL.md
        fs.writeFileSync(skillFilePath, skill.content, 'utf-8');

        // Cache the skill
        this.skillsCache.set(skill.name, skill);

        return skillFilePath;
    }

    /** Gets a cached skill by name */
    getCachedSkill(name: string): AgentSkill | undefined {
        return this.skillsCache.get(name);
    }

    /** Lists all cached skills */
    listCachedSkills(): AgentSkill[] {
        return Array.from(this.skillsCache.values());
    }
}