#!/usr/bin/env node
/**
 * Ollama Code Review MCP Server
 *
 * Provides AI-powered code review prompts and tools for Claude Desktop
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { GitService, findGitRepos } from './git.js';
import { SkillsService, AgentSkill } from './skills.js';
import { filterDiff, formatFilterSummary, DiffFilterConfig } from './diffFilter.js';
import {
  buildReviewPrompt,
  buildCommitMessagePrompt,
  buildSuggestionPrompt,
  buildExplanationPrompt,
  buildTestGenerationPrompt,
  buildFixPrompt,
  buildDocumentationPrompt,
  SkillContent,
} from './prompts.js';
import { getEffectiveConfig, getCacheDir, ServerConfig } from './config.js';

// Server state
let config: ServerConfig;
let skillsService: SkillsService;
let selectedSkills: AgentSkill[] = [];

/**
 * Create and configure the MCP server
 */
async function createServer(): Promise<Server> {
  // Load configuration
  config = await getEffectiveConfig();

  // Initialize skills service
  const cacheDir = getCacheDir();
  skillsService = new SkillsService(cacheDir, config.githubToken);
  await skillsService.initialize();

  const server = new Server(
    {
      name: 'ollama-code-review-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // Register handlers
  registerToolHandlers(server);
  registerResourceHandlers(server);
  registerPromptHandlers(server);

  return server;
}

/**
 * Register tool handlers
 */
function registerToolHandlers(server: Server): void {
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'review_staged_changes',
        description:
          'Get a code review prompt for staged git changes. Returns a prompt ready for Claude to analyze.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: {
              type: 'string',
              description: 'Path to the git repository (defaults to current directory)',
            },
            frameworks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Target frameworks for context (e.g., ["React", "TypeScript"])',
            },
            skills: {
              type: 'array',
              items: { type: 'string' },
              description: 'Skill names to apply to the review',
            },
          },
        },
      },
      {
        name: 'review_commit',
        description: 'Get a code review prompt for a specific commit',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: {
              type: 'string',
              description: 'Path to the git repository',
            },
            commitHash: {
              type: 'string',
              description: 'The commit hash to review',
            },
            frameworks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Target frameworks for context',
            },
            skills: {
              type: 'array',
              items: { type: 'string' },
              description: 'Skill names to apply',
            },
          },
          required: ['commitHash'],
        },
      },
      {
        name: 'review_commit_range',
        description: 'Get a code review prompt for a range of commits',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: {
              type: 'string',
              description: 'Path to the git repository',
            },
            fromCommit: {
              type: 'string',
              description: 'Starting commit (base)',
            },
            toCommit: {
              type: 'string',
              description: 'Ending commit (HEAD)',
            },
            frameworks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Target frameworks for context',
            },
            skills: {
              type: 'array',
              items: { type: 'string' },
              description: 'Skill names to apply',
            },
          },
          required: ['fromCommit', 'toCommit'],
        },
      },
      {
        name: 'review_branches',
        description: 'Get a code review prompt comparing two branches',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: {
              type: 'string',
              description: 'Path to the git repository',
            },
            baseBranch: {
              type: 'string',
              description: 'Base branch (e.g., main)',
            },
            targetBranch: {
              type: 'string',
              description: 'Target branch to compare',
            },
            frameworks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Target frameworks for context',
            },
            skills: {
              type: 'array',
              items: { type: 'string' },
              description: 'Skill names to apply',
            },
          },
          required: ['baseBranch', 'targetBranch'],
        },
      },
      {
        name: 'generate_commit_message',
        description:
          'Get a prompt to generate a conventional commit message for staged changes',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: {
              type: 'string',
              description: 'Path to the git repository',
            },
            draftMessage: {
              type: 'string',
              description: 'Optional draft message as a hint',
            },
          },
        },
      },
      {
        name: 'explain_code',
        description: 'Get a prompt to explain a piece of code',
        inputSchema: {
          type: 'object' as const,
          properties: {
            code: {
              type: 'string',
              description: 'The code to explain',
            },
            language: {
              type: 'string',
              description: 'Programming language (e.g., typescript, python)',
            },
          },
          required: ['code', 'language'],
        },
      },
      {
        name: 'suggest_refactoring',
        description: 'Get a prompt to suggest code improvements',
        inputSchema: {
          type: 'object' as const,
          properties: {
            code: {
              type: 'string',
              description: 'The code to analyze',
            },
            language: {
              type: 'string',
              description: 'Programming language',
            },
          },
          required: ['code', 'language'],
        },
      },
      {
        name: 'generate_tests',
        description: 'Get a prompt to generate unit tests for code',
        inputSchema: {
          type: 'object' as const,
          properties: {
            code: {
              type: 'string',
              description: 'The code to generate tests for',
            },
            language: {
              type: 'string',
              description: 'Programming language',
            },
            testFramework: {
              type: 'string',
              description: 'Test framework to use (e.g., jest, pytest, mocha)',
            },
          },
          required: ['code', 'language'],
        },
      },
      {
        name: 'fix_code',
        description: 'Get a prompt to fix issues in code',
        inputSchema: {
          type: 'object' as const,
          properties: {
            code: {
              type: 'string',
              description: 'The code to fix',
            },
            language: {
              type: 'string',
              description: 'Programming language',
            },
            issue: {
              type: 'string',
              description: 'Description of the issue to fix (optional)',
            },
          },
          required: ['code', 'language'],
        },
      },
      {
        name: 'generate_documentation',
        description: 'Get a prompt to generate documentation for code',
        inputSchema: {
          type: 'object' as const,
          properties: {
            code: {
              type: 'string',
              description: 'The code to document',
            },
            language: {
              type: 'string',
              description: 'Programming language',
            },
            style: {
              type: 'string',
              enum: ['jsdoc', 'tsdoc', 'docstring', 'generic'],
              description: 'Documentation style',
            },
          },
          required: ['code', 'language'],
        },
      },
      {
        name: 'list_skills',
        description: 'List available agent skills from configured repositories',
        inputSchema: {
          type: 'object' as const,
          properties: {
            refresh: {
              type: 'boolean',
              description: 'Force refresh from GitHub',
            },
          },
        },
      },
      {
        name: 'select_skills',
        description: 'Select skills to apply to reviews',
        inputSchema: {
          type: 'object' as const,
          properties: {
            skillNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'Names of skills to select',
            },
          },
          required: ['skillNames'],
        },
      },
      {
        name: 'clear_skills',
        description: 'Clear all selected skills',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'get_git_status',
        description: 'Get the current git repository status',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: {
              type: 'string',
              description: 'Path to the git repository',
            },
          },
        },
      },
      {
        name: 'list_commits',
        description: 'List recent commits in the repository',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: {
              type: 'string',
              description: 'Path to the git repository',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of commits to return (default: 10)',
            },
          },
        },
      },
      {
        name: 'list_branches',
        description: 'List branches in the repository',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: {
              type: 'string',
              description: 'Path to the git repository',
            },
          },
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case 'review_staged_changes':
          return await handleReviewStagedChanges(args);
        case 'review_commit':
          return await handleReviewCommit(args);
        case 'review_commit_range':
          return await handleReviewCommitRange(args);
        case 'review_branches':
          return await handleReviewBranches(args);
        case 'generate_commit_message':
          return await handleGenerateCommitMessage(args);
        case 'explain_code':
          return await handleExplainCode(args);
        case 'suggest_refactoring':
          return await handleSuggestRefactoring(args);
        case 'generate_tests':
          return await handleGenerateTests(args);
        case 'fix_code':
          return await handleFixCode(args);
        case 'generate_documentation':
          return await handleGenerateDocumentation(args);
        case 'list_skills':
          return await handleListSkills(args);
        case 'select_skills':
          return await handleSelectSkills(args);
        case 'clear_skills':
          return await handleClearSkills();
        case 'get_git_status':
          return await handleGetGitStatus(args);
        case 'list_commits':
          return await handleListCommits(args);
        case 'list_branches':
          return await handleListBranches(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });
}

/**
 * Get skills content for prompts
 */
function getSkillsContent(skillNames?: string[]): SkillContent[] {
  const skills = skillNames
    ? skillNames
        .map((name) => skillsService.getCachedSkill(name))
        .filter((s): s is AgentSkill => s !== undefined)
    : selectedSkills;

  return skills.map((s) => ({ name: s.name, content: s.content }));
}

/**
 * Tool handlers
 */
async function handleReviewStagedChanges(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const workingDir = (args.workingDir as string) || config.defaultWorkingDir || process.cwd();
  const frameworks = (args.frameworks as string[]) || config.frameworks;
  const skillNames = args.skills as string[] | undefined;

  const git = new GitService(workingDir);

  if (!(await git.isValidRepo())) {
    throw new Error(`Not a valid git repository: ${workingDir}`);
  }

  const { diff, files, stats } = await git.getStagedDiff();

  if (!diff.trim()) {
    return {
      content: [
        {
          type: 'text',
          text: 'No staged changes found. Stage some changes with `git add` first.',
        },
      ],
    };
  }

  // Filter the diff
  const filtered = filterDiff(diff, config.diffFilter);
  const filterSummary = formatFilterSummary(filtered.stats);

  // Build the prompt
  const skills = getSkillsContent(skillNames);
  const prompt = buildReviewPrompt(filtered.filteredDiff, { frameworks, skills });

  return {
    content: [
      {
        type: 'text',
        text: `## Code Review Request

**Repository:** ${workingDir}
**Files changed:** ${files.join(', ')}
**Stats:** +${stats.insertions} -${stats.deletions} in ${stats.filesChanged} file(s)
**Filter:** ${filterSummary}
${skills.length > 0 ? `**Skills applied:** ${skills.map((s) => s.name).join(', ')}` : ''}

---

${prompt}`,
      },
    ],
  };
}

async function handleReviewCommit(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const workingDir = (args.workingDir as string) || config.defaultWorkingDir || process.cwd();
  const commitHash = args.commitHash as string;
  const frameworks = (args.frameworks as string[]) || config.frameworks;
  const skillNames = args.skills as string[] | undefined;

  if (!commitHash) {
    throw new Error('commitHash is required');
  }

  const git = new GitService(workingDir);

  if (!(await git.isValidRepo())) {
    throw new Error(`Not a valid git repository: ${workingDir}`);
  }

  const { diff, files, stats } = await git.getCommitDiff(commitHash);
  const filtered = filterDiff(diff, config.diffFilter);
  const filterSummary = formatFilterSummary(filtered.stats);

  const skills = getSkillsContent(skillNames);
  const prompt = buildReviewPrompt(filtered.filteredDiff, { frameworks, skills });

  return {
    content: [
      {
        type: 'text',
        text: `## Code Review Request - Commit ${commitHash.substring(0, 7)}

**Repository:** ${workingDir}
**Files changed:** ${files.join(', ')}
**Stats:** +${stats.insertions} -${stats.deletions} in ${stats.filesChanged} file(s)
**Filter:** ${filterSummary}
${skills.length > 0 ? `**Skills applied:** ${skills.map((s) => s.name).join(', ')}` : ''}

---

${prompt}`,
      },
    ],
  };
}

async function handleReviewCommitRange(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const workingDir = (args.workingDir as string) || config.defaultWorkingDir || process.cwd();
  const fromCommit = args.fromCommit as string;
  const toCommit = args.toCommit as string;
  const frameworks = (args.frameworks as string[]) || config.frameworks;
  const skillNames = args.skills as string[] | undefined;

  if (!fromCommit || !toCommit) {
    throw new Error('fromCommit and toCommit are required');
  }

  const git = new GitService(workingDir);

  if (!(await git.isValidRepo())) {
    throw new Error(`Not a valid git repository: ${workingDir}`);
  }

  const { diff, files, stats } = await git.getCommitRangeDiff(fromCommit, toCommit);
  const filtered = filterDiff(diff, config.diffFilter);
  const filterSummary = formatFilterSummary(filtered.stats);

  const skills = getSkillsContent(skillNames);
  const prompt = buildReviewPrompt(filtered.filteredDiff, { frameworks, skills });

  return {
    content: [
      {
        type: 'text',
        text: `## Code Review Request - Commits ${fromCommit.substring(0, 7)}..${toCommit.substring(0, 7)}

**Repository:** ${workingDir}
**Files changed:** ${files.join(', ')}
**Stats:** +${stats.insertions} -${stats.deletions} in ${stats.filesChanged} file(s)
**Filter:** ${filterSummary}
${skills.length > 0 ? `**Skills applied:** ${skills.map((s) => s.name).join(', ')}` : ''}

---

${prompt}`,
      },
    ],
  };
}

async function handleReviewBranches(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const workingDir = (args.workingDir as string) || config.defaultWorkingDir || process.cwd();
  const baseBranch = args.baseBranch as string;
  const targetBranch = args.targetBranch as string;
  const frameworks = (args.frameworks as string[]) || config.frameworks;
  const skillNames = args.skills as string[] | undefined;

  if (!baseBranch || !targetBranch) {
    throw new Error('baseBranch and targetBranch are required');
  }

  const git = new GitService(workingDir);

  if (!(await git.isValidRepo())) {
    throw new Error(`Not a valid git repository: ${workingDir}`);
  }

  const { diff, files, stats } = await git.getBranchDiff(baseBranch, targetBranch);
  const filtered = filterDiff(diff, config.diffFilter);
  const filterSummary = formatFilterSummary(filtered.stats);

  const skills = getSkillsContent(skillNames);
  const prompt = buildReviewPrompt(filtered.filteredDiff, { frameworks, skills });

  return {
    content: [
      {
        type: 'text',
        text: `## Code Review Request - Branch Comparison

**Repository:** ${workingDir}
**Comparing:** ${baseBranch} → ${targetBranch}
**Files changed:** ${files.join(', ')}
**Stats:** +${stats.insertions} -${stats.deletions} in ${stats.filesChanged} file(s)
**Filter:** ${filterSummary}
${skills.length > 0 ? `**Skills applied:** ${skills.map((s) => s.name).join(', ')}` : ''}

---

${prompt}`,
      },
    ],
  };
}

async function handleGenerateCommitMessage(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const workingDir = (args.workingDir as string) || config.defaultWorkingDir || process.cwd();
  const draftMessage = args.draftMessage as string | undefined;

  const git = new GitService(workingDir);

  if (!(await git.isValidRepo())) {
    throw new Error(`Not a valid git repository: ${workingDir}`);
  }

  const { diff, files, stats } = await git.getStagedDiff();

  if (!diff.trim()) {
    return {
      content: [
        {
          type: 'text',
          text: 'No staged changes found. Stage some changes with `git add` first.',
        },
      ],
    };
  }

  const filtered = filterDiff(diff, config.diffFilter);
  const prompt = buildCommitMessagePrompt(filtered.filteredDiff, draftMessage);

  return {
    content: [
      {
        type: 'text',
        text: `## Generate Commit Message

**Repository:** ${workingDir}
**Files:** ${files.join(', ')}
**Stats:** +${stats.insertions} -${stats.deletions}

---

${prompt}`,
      },
    ],
  };
}

async function handleExplainCode(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const code = args.code as string;
  const language = args.language as string;

  if (!code || !language) {
    throw new Error('code and language are required');
  }

  const prompt = buildExplanationPrompt(code, language);

  return {
    content: [{ type: 'text', text: prompt }],
  };
}

async function handleSuggestRefactoring(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const code = args.code as string;
  const language = args.language as string;

  if (!code || !language) {
    throw new Error('code and language are required');
  }

  const prompt = buildSuggestionPrompt(code, language);

  return {
    content: [{ type: 'text', text: prompt }],
  };
}

async function handleGenerateTests(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const code = args.code as string;
  const language = args.language as string;
  const testFramework = args.testFramework as string | undefined;

  if (!code || !language) {
    throw new Error('code and language are required');
  }

  const prompt = buildTestGenerationPrompt(code, language, testFramework);

  return {
    content: [{ type: 'text', text: prompt }],
  };
}

async function handleFixCode(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const code = args.code as string;
  const language = args.language as string;
  const issue = args.issue as string | undefined;

  if (!code || !language) {
    throw new Error('code and language are required');
  }

  const prompt = buildFixPrompt(code, language, issue);

  return {
    content: [{ type: 'text', text: prompt }],
  };
}

async function handleGenerateDocumentation(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const code = args.code as string;
  const language = args.language as string;
  const style = args.style as 'jsdoc' | 'tsdoc' | 'docstring' | 'generic' | undefined;

  if (!code || !language) {
    throw new Error('code and language are required');
  }

  const prompt = buildDocumentationPrompt(code, language, style);

  return {
    content: [{ type: 'text', text: prompt }],
  };
}

async function handleListSkills(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const refresh = args.refresh as boolean;

  let skills: AgentSkill[];

  if (refresh || skillsService.getAvailableSkills().length === 0) {
    skills = await skillsService.fetchSkillsFromAllRepos(config.skillRepositories);
  } else {
    skills = skillsService.getAvailableSkills();
  }

  const downloaded = skillsService.getDownloadedSkills();
  const downloadedNames = new Set(downloaded.map((s) => s.name));

  const skillList = skills
    .map((s) => {
      const cached = downloadedNames.has(s.name) ? ' ✓' : '';
      const selected = selectedSkills.some((sel) => sel.name === s.name) ? ' [selected]' : '';
      return `- **${s.name}**${cached}${selected}: ${s.description} (from ${s.repository})`;
    })
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text: `## Available Skills

${skillList}

**Legend:** ✓ = cached locally, [selected] = will be applied to reviews

Use \`select_skills\` to choose skills for reviews.`,
      },
    ],
  };
}

async function handleSelectSkills(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const skillNames = args.skillNames as string[];

  if (!skillNames || skillNames.length === 0) {
    throw new Error('skillNames array is required');
  }

  selectedSkills = [];

  for (const name of skillNames) {
    // Try to get from cache first
    let skill = skillsService.getCachedSkill(name);

    if (!skill) {
      // Try to find in available skills
      const available = skillsService.getAvailableSkills();
      const found = available.find((s) => s.name === name);

      if (found) {
        // Download and cache
        skill = await skillsService.downloadSkill(found);
      }
    }

    if (skill) {
      selectedSkills.push(skill);
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `Selected ${selectedSkills.length} skill(s): ${selectedSkills.map((s) => s.name).join(', ')}

These skills will be applied to subsequent reviews.`,
      },
    ],
  };
}

async function handleClearSkills(): Promise<{ content: Array<{ type: string; text: string }> }> {
  selectedSkills = [];

  return {
    content: [{ type: 'text', text: 'Cleared all selected skills.' }],
  };
}

async function handleGetGitStatus(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const workingDir = (args.workingDir as string) || config.defaultWorkingDir || process.cwd();

  const git = new GitService(workingDir);

  if (!(await git.isValidRepo())) {
    throw new Error(`Not a valid git repository: ${workingDir}`);
  }

  const status = await git.getStatus();
  const branch = await git.getCurrentBranch();

  return {
    content: [
      {
        type: 'text',
        text: `## Git Status

**Repository:** ${workingDir}
**Branch:** ${branch}

**Staged files:** ${status.staged.length > 0 ? status.staged.join(', ') : '(none)'}
**Modified files:** ${status.unstaged.length > 0 ? status.unstaged.join(', ') : '(none)'}
**Untracked files:** ${status.untracked.length > 0 ? status.untracked.join(', ') : '(none)'}`,
      },
    ],
  };
}

async function handleListCommits(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const workingDir = (args.workingDir as string) || config.defaultWorkingDir || process.cwd();
  const limit = (args.limit as number) || 10;

  const git = new GitService(workingDir);

  if (!(await git.isValidRepo())) {
    throw new Error(`Not a valid git repository: ${workingDir}`);
  }

  const commits = await git.getRecentCommits(limit);

  const commitList = commits
    .map((c) => `- \`${c.hash.substring(0, 7)}\` ${c.message} (${c.author}, ${c.date})`)
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text: `## Recent Commits

**Repository:** ${workingDir}

${commitList}`,
      },
    ],
  };
}

async function handleListBranches(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const workingDir = (args.workingDir as string) || config.defaultWorkingDir || process.cwd();

  const git = new GitService(workingDir);

  if (!(await git.isValidRepo())) {
    throw new Error(`Not a valid git repository: ${workingDir}`);
  }

  const branches = await git.getBranches();

  const branchList = branches.all
    .map((b) => (b === branches.current ? `- **${b}** (current)` : `- ${b}`))
    .join('\n');

  return {
    content: [
      {
        type: 'text',
        text: `## Branches

**Repository:** ${workingDir}

${branchList}`,
      },
    ],
  };
}

/**
 * Register resource handlers
 */
function registerResourceHandlers(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'config://settings',
        name: 'Server Configuration',
        description: 'Current server configuration settings',
        mimeType: 'application/json',
      },
      {
        uri: 'skills://selected',
        name: 'Selected Skills',
        description: 'Currently selected skills for reviews',
        mimeType: 'application/json',
      },
      {
        uri: 'skills://downloaded',
        name: 'Downloaded Skills',
        description: 'All downloaded and cached skills',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    switch (uri) {
      case 'config://settings':
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(config, null, 2),
            },
          ],
        };

      case 'skills://selected':
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                selectedSkills.map((s) => ({
                  name: s.name,
                  description: s.description,
                  repository: s.repository,
                })),
                null,
                2
              ),
            },
          ],
        };

      case 'skills://downloaded':
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                skillsService.getDownloadedSkills().map((s) => ({
                  name: s.name,
                  description: s.description,
                  repository: s.repository,
                  downloadedAt: s.downloadedAt,
                })),
                null,
                2
              ),
            },
          ],
        };

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });
}

/**
 * Register prompt handlers (pre-built prompts for common tasks)
 */
function registerPromptHandlers(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'code_review',
        description: 'Review code changes with expert analysis',
        arguments: [
          {
            name: 'diff',
            description: 'Git diff content to review',
            required: true,
          },
          {
            name: 'frameworks',
            description: 'Comma-separated list of frameworks (e.g., React,TypeScript)',
            required: false,
          },
        ],
      },
      {
        name: 'commit_message',
        description: 'Generate a conventional commit message',
        arguments: [
          {
            name: 'diff',
            description: 'Git diff content',
            required: true,
          },
          {
            name: 'draft',
            description: 'Optional draft message as a hint',
            required: false,
          },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'code_review': {
        const diff = args?.diff as string;
        const frameworks = args?.frameworks
          ? (args.frameworks as string).split(',').map((f) => f.trim())
          : config.frameworks;

        if (!diff) {
          throw new Error('diff argument is required');
        }

        const skills = getSkillsContent();
        const prompt = buildReviewPrompt(diff, { frameworks, skills });

        return {
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: prompt },
            },
          ],
        };
      }

      case 'commit_message': {
        const diff = args?.diff as string;
        const draft = args?.draft as string | undefined;

        if (!diff) {
          throw new Error('diff argument is required');
        }

        const prompt = buildCommitMessagePrompt(diff, draft);

        return {
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: prompt },
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error('Ollama Code Review MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
