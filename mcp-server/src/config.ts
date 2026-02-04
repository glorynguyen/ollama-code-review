/**
 * Configuration management for the MCP server
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface ServerConfig {
  /** Default frameworks for code review context */
  frameworks: string[];

  /** Default skill repositories */
  skillRepositories: string[];

  /** Diff filter settings */
  diffFilter: {
    ignorePaths: string[];
    ignorePatterns: string[];
    maxFileLines: number;
    ignoreFormattingOnly: boolean;
  };

  /** GitHub token for skill fetching (optional, for rate limits) */
  githubToken?: string;

  /** Default working directory for git operations */
  defaultWorkingDir?: string;
}

const DEFAULT_CONFIG: ServerConfig = {
  frameworks: ['React', 'TypeScript', 'Node.js'],
  skillRepositories: ['vercel-labs/agent-skills'],
  diffFilter: {
    ignorePaths: [
      'node_modules/**',
      '**/node_modules/**',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'dist/**',
      'build/**',
      '.next/**',
      'coverage/**',
    ],
    ignorePatterns: ['*.min.js', '*.min.css', '*.map', '*.generated.*'],
    maxFileLines: 500,
    ignoreFormattingOnly: false,
  },
};

/**
 * Get the config directory path
 */
export function getConfigDir(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configDir, 'ollama-code-review-mcp');
}

/**
 * Get the cache directory path
 */
export function getCacheDir(): string {
  const cacheDir = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cacheDir, 'ollama-code-review-mcp');
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Load configuration from file
 */
export async function loadConfig(): Promise<ServerConfig> {
  const configPath = getConfigPath();

  try {
    const configData = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(configData) as Partial<ServerConfig>;

    // Merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
      diffFilter: {
        ...DEFAULT_CONFIG.diffFilter,
        ...userConfig.diffFilter,
      },
    };
  } catch {
    // Config doesn't exist or is invalid, use defaults
    return DEFAULT_CONFIG;
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: Partial<ServerConfig>): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();

  await fs.mkdir(configDir, { recursive: true });

  const currentConfig = await loadConfig();
  const newConfig = {
    ...currentConfig,
    ...config,
    diffFilter: {
      ...currentConfig.diffFilter,
      ...config.diffFilter,
    },
  };

  await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2));
}

/**
 * Get a specific config value
 */
export async function getConfigValue<K extends keyof ServerConfig>(
  key: K
): Promise<ServerConfig[K]> {
  const config = await loadConfig();
  return config[key];
}

/**
 * Set a specific config value
 */
export async function setConfigValue<K extends keyof ServerConfig>(
  key: K,
  value: ServerConfig[K]
): Promise<void> {
  await saveConfig({ [key]: value });
}

/**
 * Initialize config with environment variables
 */
export function getEnvConfig(): Partial<ServerConfig> {
  const envConfig: Partial<ServerConfig> = {};

  if (process.env.GITHUB_TOKEN) {
    envConfig.githubToken = process.env.GITHUB_TOKEN;
  }

  if (process.env.CODE_REVIEW_FRAMEWORKS) {
    envConfig.frameworks = process.env.CODE_REVIEW_FRAMEWORKS.split(',').map((f) =>
      f.trim()
    );
  }

  if (process.env.CODE_REVIEW_WORKING_DIR) {
    envConfig.defaultWorkingDir = process.env.CODE_REVIEW_WORKING_DIR;
  }

  return envConfig;
}

/**
 * Merge all config sources (env > file > defaults)
 */
export async function getEffectiveConfig(): Promise<ServerConfig> {
  const fileConfig = await loadConfig();
  const envConfig = getEnvConfig();

  return {
    ...fileConfig,
    ...envConfig,
    diffFilter: {
      ...fileConfig.diffFilter,
    },
  };
}
