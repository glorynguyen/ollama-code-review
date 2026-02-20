/**
 * F-010: CI/CD Integration — Core review logic
 * Calls the appropriate AI provider and returns the review text.
 */

import axios from 'axios';
import * as fs from 'fs';
import { CliConfig, PROFILE_PROMPTS } from './config';

const DEFAULT_REVIEW_PROMPT = `You are a senior software engineer performing a thorough code review.
Analyze the following git diff and provide a structured review covering:

1. **Critical Issues** — bugs, security vulnerabilities, data loss risks
2. **High Priority** — logic errors, performance problems, breaking changes
3. **Medium Priority** — code quality, maintainability, missing error handling
4. **Low Priority / Suggestions** — style, naming, minor improvements

For each finding, clearly state:
- Severity: [CRITICAL | HIGH | MEDIUM | LOW]
- File and line number (if applicable)
- Description of the issue
- Suggested fix or improvement

\${profile}

Code diff to review:
\`\`\`diff
\${code}
\`\`\``;

/** Build the review prompt from the diff and config. */
export function buildPrompt(diff: string, config: CliConfig): string {
  let template = DEFAULT_REVIEW_PROMPT;

  // Override with custom prompt file if provided
  if (config.promptFile && fs.existsSync(config.promptFile)) {
    template = fs.readFileSync(config.promptFile, 'utf8');
  }

  const profileContext = PROFILE_PROMPTS[config.profile] ?? '';
  return template
    .replace('${code}', diff)
    .replace('${profile}', profileContext ? `\n**Review focus:** ${profileContext}\n` : '');
}

/** Call the appropriate AI provider and return the review text. */
export async function callAIProvider(prompt: string, config: CliConfig): Promise<string> {
  switch (config.provider) {
    case 'ollama':
      return callOllama(prompt, config);
    case 'claude':
      return callClaude(prompt, config);
    case 'gemini':
      return callGemini(prompt, config);
    case 'mistral':
      return callMistral(prompt, config);
    case 'glm':
      return callGlm(prompt, config);
    case 'minimax':
      return callMiniMax(prompt, config);
    case 'openai-compatible':
      return callOpenAICompatible(prompt, config);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// ─── provider implementations ─────────────────────────────────────────────────

async function callOllama(prompt: string, config: CliConfig): Promise<string> {
  const response = await axios.post(
    config.ollamaEndpoint,
    {
      model: config.model,
      prompt,
      temperature: config.temperature,
      stream: false,
    },
    { timeout: 300_000 },
  );
  return response.data?.response ?? '';
}

async function callClaude(prompt: string, config: CliConfig): Promise<string> {
  if (!config.claudeApiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for Claude models.');
  }
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: config.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: config.temperature,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': config.claudeApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 300_000,
    },
  );
  return response.data?.content?.[0]?.text ?? '';
}

async function callGemini(prompt: string, config: CliConfig): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required for Gemini models.');
  }
  const model = config.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
  const response = await axios.post(
    url,
    { contents: [{ parts: [{ text: prompt }] }] },
    { timeout: 300_000 },
  );
  return response.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callMistral(prompt: string, config: CliConfig): Promise<string> {
  if (!config.mistralApiKey) {
    throw new Error('MISTRAL_API_KEY environment variable is required for Mistral models.');
  }
  const response = await axios.post(
    'https://api.mistral.ai/v1/chat/completions',
    {
      model: config.model || 'codestral-latest',
      temperature: config.temperature,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${config.mistralApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 300_000,
    },
  );
  return response.data?.choices?.[0]?.message?.content ?? '';
}

async function callGlm(prompt: string, config: CliConfig): Promise<string> {
  if (!config.glmApiKey) {
    throw new Error('GLM_API_KEY environment variable is required for GLM models.');
  }
  const response = await axios.post(
    'https://api.z.ai/api/paas/v4/chat/completions',
    {
      model: config.model || 'glm-4.7-flash',
      temperature: config.temperature,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${config.glmApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 300_000,
    },
  );
  return response.data?.choices?.[0]?.message?.content ?? '';
}

async function callMiniMax(prompt: string, config: CliConfig): Promise<string> {
  if (!config.minimaxApiKey) {
    throw new Error('MINIMAX_API_KEY environment variable is required for MiniMax models.');
  }
  const response = await axios.post(
    'https://api.minimax.io/v1/text/chatcompletion_v2',
    {
      model: config.model || 'MiniMax-M2.5',
      temperature: config.temperature,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 300_000,
    },
  );
  return response.data?.choices?.[0]?.message?.content ?? '';
}

async function callOpenAICompatible(prompt: string, config: CliConfig): Promise<string> {
  const endpoint = `${config.openaiCompatibleEndpoint.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.openaiCompatibleApiKey) {
    headers['Authorization'] = `Bearer ${config.openaiCompatibleApiKey}`;
  }
  const response = await axios.post(
    endpoint,
    {
      model: config.openaiCompatibleModel || config.model,
      temperature: config.temperature,
      messages: [{ role: 'user', content: prompt }],
    },
    { headers, timeout: 300_000 },
  );
  return response.data?.choices?.[0]?.message?.content ?? '';
}
