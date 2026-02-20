/**
 * F-010: CI/CD Integration — Configuration helpers
 */

export type Provider =
  | 'ollama'
  | 'claude'
  | 'gemini'
  | 'mistral'
  | 'openai-compatible'
  | 'glm'
  | 'minimax';

export interface CliConfig {
  /** AI provider to use */
  provider: Provider;
  /** Ollama model name (for ollama provider) */
  model: string;
  /** Ollama endpoint URL */
  ollamaEndpoint: string;
  /** Anthropic API key (claude provider) */
  claudeApiKey: string;
  /** Google AI Studio API key (gemini provider) */
  geminiApiKey: string;
  /** Mistral AI API key (mistral provider) */
  mistralApiKey: string;
  /** GLM / Z.AI API key */
  glmApiKey: string;
  /** MiniMax API key */
  minimaxApiKey: string;
  /** OpenAI-compatible endpoint URL */
  openaiCompatibleEndpoint: string;
  /** OpenAI-compatible API key */
  openaiCompatibleApiKey: string;
  /** OpenAI-compatible model name */
  openaiCompatibleModel: string;
  /** Review profile */
  profile: string;
  /** Fail exit code if findings at or above this severity are found */
  failOnSeverity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  /** Post review comment to GitHub PR (requires GITHUB_TOKEN env) */
  postToGitHub: boolean;
  /** Output format */
  outputFormat: 'text' | 'json' | 'markdown';
  /** GitHub token for posting comments */
  githubToken: string;
  /** Temperature for AI generation */
  temperature: number;
  /** Path to custom review prompt file */
  promptFile: string;
  /** Maximum tokens / characters for the diff */
  maxDiffLength: number;
  /** Verbose logging */
  verbose: boolean;
}

/** Build CLI config by merging command-line args with environment variables. */
export function buildConfig(args: Partial<CliConfig>): CliConfig {
  return {
    provider: (args.provider ?? process.env.OCR_PROVIDER ?? 'ollama') as Provider,
    model: args.model ?? process.env.OCR_MODEL ?? 'qwen2.5-coder:14b-instruct-q4_0',
    ollamaEndpoint:
      args.ollamaEndpoint ??
      process.env.OCR_OLLAMA_ENDPOINT ??
      'http://localhost:11434/api/generate',
    claudeApiKey: args.claudeApiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
    geminiApiKey: args.geminiApiKey ?? process.env.GEMINI_API_KEY ?? '',
    mistralApiKey: args.mistralApiKey ?? process.env.MISTRAL_API_KEY ?? '',
    glmApiKey: args.glmApiKey ?? process.env.GLM_API_KEY ?? '',
    minimaxApiKey: args.minimaxApiKey ?? process.env.MINIMAX_API_KEY ?? '',
    openaiCompatibleEndpoint:
      args.openaiCompatibleEndpoint ??
      process.env.OCR_OPENAI_COMPATIBLE_ENDPOINT ??
      'http://localhost:1234/v1',
    openaiCompatibleApiKey:
      args.openaiCompatibleApiKey ?? process.env.OCR_OPENAI_COMPATIBLE_API_KEY ?? '',
    openaiCompatibleModel:
      args.openaiCompatibleModel ?? process.env.OCR_OPENAI_COMPATIBLE_MODEL ?? '',
    profile: args.profile ?? process.env.OCR_PROFILE ?? 'general',
    failOnSeverity: (args.failOnSeverity ??
      process.env.OCR_FAIL_ON_SEVERITY ??
      'none') as CliConfig['failOnSeverity'],
    postToGitHub: args.postToGitHub ?? process.env.OCR_POST_TO_GITHUB === 'true',
    outputFormat: (args.outputFormat ?? process.env.OCR_OUTPUT_FORMAT ?? 'text') as
      CliConfig['outputFormat'],
    githubToken: args.githubToken ?? process.env.GITHUB_TOKEN ?? '',
    temperature: args.temperature ?? Number(process.env.OCR_TEMPERATURE ?? '0'),
    promptFile: args.promptFile ?? process.env.OCR_PROMPT_FILE ?? '',
    maxDiffLength: args.maxDiffLength ?? Number(process.env.OCR_MAX_DIFF_LENGTH ?? '50000'),
    verbose: args.verbose ?? process.env.OCR_VERBOSE === 'true',
  };
}

/** Profile-specific prompt prefixes (mirrors the VS Code extension profiles) */
export const PROFILE_PROMPTS: Record<string, string> = {
  general: '',
  security:
    'Focus on security vulnerabilities: injection flaws, authentication issues, secrets exposure, insecure cryptography, path traversal, and data validation. Severity: strict.',
  performance:
    'Focus on performance: algorithmic complexity, memory leaks, N+1 queries, unnecessary re-renders, inefficient data structures, and missing caching opportunities.',
  accessibility:
    'Focus on accessibility: ARIA attributes, keyboard navigation, colour contrast, screen reader support, focus management, and semantic HTML.',
  educational:
    'Focus on teaching: explain why changes are good or bad. Highlight design patterns, common pitfalls, idiomatic usage, and testing best practices. Severity: lenient.',
  strict:
    'Apply the strictest review. Flag every issue including edge cases, type safety, test coverage gaps, documentation gaps, and subtle logic errors.',
  'owasp-top10':
    'Audit against the OWASP Top 10 (2021). For every finding cite the relevant category (e.g. A03:2021 – Injection).',
  'pci-dss':
    'Audit against PCI-DSS v4. Cite requirement numbers (e.g. Requirement 6.2.4) for every finding.',
  gdpr: 'Audit against GDPR/CCPA. Cite Article references (e.g. Art. 5 – Principles) for every finding.',
  hipaa: 'Audit against HIPAA Security and Privacy Rules. Cite section numbers (e.g. § 164.312) for every finding.',
  soc2: 'Audit against SOC 2 Type II Trust Services Criteria. Cite TSC IDs (e.g. CC6.1) for every finding.',
  'nist-csf':
    'Audit against NIST Cybersecurity Framework 2.0. Cite CSF functions and subcategories (e.g. PR.AC-1) for every finding.',
};
