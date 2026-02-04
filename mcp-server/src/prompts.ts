/**
 * Prompt templates for code review operations
 * Ported from the VS Code extension
 */

export interface PromptOptions {
  frameworks?: string[];
  skills?: SkillContent[];
  temperature?: number;
}

export interface SkillContent {
  name: string;
  content: string;
}

/**
 * Build the skill context section for prompts
 */
function buildSkillContext(skills?: SkillContent[]): string {
  if (!skills || skills.length === 0) {
    return '';
  }

  const skillsText = skills
    .map((skill, index) => `### Skill ${index + 1}: ${skill.name}\n${skill.content}`)
    .join('\n\n');

  return `\n\nAdditional Review Guidelines (${skills.length} skill(s) applied):\n${skillsText}\n`;
}

/**
 * Build the code review prompt
 */
export function buildReviewPrompt(diff: string, options: PromptOptions = {}): string {
  const { frameworks = ['React'], skills } = options;
  const frameworksList = frameworks.join(', ');
  const skillContext = buildSkillContext(skills);

  return `You are an expert software engineer and code reviewer with deep knowledge of: **${frameworksList}**.

I will provide you with a git diff. Your task is to review it thoroughly.

**Understanding the Diff Format:**
- Lines starting with \`---\` indicate the original file path
- Lines starting with \`+++\` indicate the new file path
- Lines starting with \`@@\` show line numbers: \`@@ -start,count +start,count @@\`
- Lines starting with \`-\` (in the diff body) are REMOVED lines
- Lines starting with \`+\` (in the diff body) are ADDED lines
- Lines with no prefix are context (unchanged) lines

**Review Focus:**
1. **${frameworksList}-specific bugs** - Look for common pitfalls, anti-patterns, and framework-specific issues
2. **Performance** - Identify any potential performance concerns or optimizations
3. **Code style** - Check for consistency, readability, and adherence to best practices
4. **Security** - Flag any security vulnerabilities or concerns
5. **Maintainability** - Assess code structure, naming, and documentation
${skillContext}
---
${diff}
---

Please provide a thorough code review. If you find no significant issues, state: "I have reviewed the changes and found no significant issues."`;
}

/**
 * Build the commit message generation prompt
 */
export function buildCommitMessagePrompt(diff: string, draftMessage?: string): string {
  const draftHint = draftMessage
    ? `\n\nThe developer has provided a draft message as a hint: "${draftMessage}"\nUse this as guidance but improve it following the format below.`
    : '';

  return `You are a git commit message expert. Generate a conventional commit message for the following diff.
${draftHint}
**Format Requirements:**
- Type: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert
- Format: type(scope): description
- Description must be under 50 characters
- Use imperative mood (e.g., "add" not "added")
- Do not end with a period

**Type Definitions:**
- feat: A new feature (triggers minor version bump)
- fix: A bug fix (triggers patch version bump)
- docs: Documentation only changes
- style: Code style changes (formatting, whitespace)
- refactor: Code change that neither fixes a bug nor adds a feature
- perf: Performance improvement
- test: Adding or updating tests
- build: Build system or external dependencies
- ci: CI configuration changes
- chore: Other changes that don't modify src or test files
- revert: Reverts a previous commit

**Breaking Changes:**
If this is a breaking change, add a footer: BREAKING CHANGE: description

---
${diff}
---

Generate ONLY the commit message, nothing else.`;
}

/**
 * Build the code suggestion/refactoring prompt
 */
export function buildSuggestionPrompt(code: string, language: string): string {
  return `You are an expert software engineer. Analyze the following ${language} code and suggest improvements.

**Response Format:**
1. First, provide the improved code in a markdown code block with the language identifier
2. Then, provide a bulleted list explaining each improvement

If the code is already well-written, state: "The selected code is well-written and I have no suggestions for improvement."

\`\`\`${language}
${code}
\`\`\``;
}

/**
 * Build the code explanation prompt
 */
export function buildExplanationPrompt(code: string, language: string): string {
  return `You are an expert software engineer. Explain the following ${language} code in detail.

**Please provide:**
1. A brief summary (1-2 sentences) of what this code does
2. A step-by-step breakdown of the logic
3. Any notable patterns, algorithms, or techniques used
4. Potential edge cases or issues to be aware of
5. How this code might interact with other parts of a system

\`\`\`${language}
${code}
\`\`\``;
}

/**
 * Build the test generation prompt
 */
export function buildTestGenerationPrompt(
  code: string,
  language: string,
  testFramework?: string
): string {
  const frameworkHint = testFramework
    ? `Use the **${testFramework}** testing framework.`
    : 'Use an appropriate testing framework for this language.';

  return `You are an expert software engineer. Generate comprehensive unit tests for the following ${language} code.

${frameworkHint}

**Response Format:**
1. First, provide the test code in a markdown code block with the language identifier
2. Then, provide a bulleted list explaining what each test covers

**Test Coverage Guidelines:**
- Test happy path scenarios
- Test edge cases and boundary conditions
- Test error handling
- Test any async behavior if applicable
- Mock external dependencies appropriately

\`\`\`${language}
${code}
\`\`\``;
}

/**
 * Build the fix issue prompt
 */
export function buildFixPrompt(
  code: string,
  language: string,
  issue?: string
): string {
  const issueContext = issue
    ? `\n**Issue to fix:** ${issue}`
    : '\n**Task:** Identify and fix any issues in this code.';

  return `You are an expert software engineer. Fix the following ${language} code.
${issueContext}

**Response Format:**
1. First, provide the fixed code in a markdown code block with the language identifier
2. Then, explain what was wrong and how you fixed it

\`\`\`${language}
${code}
\`\`\``;
}

/**
 * Build the documentation generation prompt
 */
export function buildDocumentationPrompt(
  code: string,
  language: string,
  docStyle?: 'jsdoc' | 'tsdoc' | 'docstring' | 'generic'
): string {
  const styleGuide = {
    jsdoc: 'JSDoc format with @param, @returns, @throws, and @example tags',
    tsdoc: 'TSDoc format with TypeScript-specific tags',
    docstring: 'Python docstring format with Args, Returns, Raises, and Examples sections',
    generic: 'appropriate documentation format for the language',
  };

  const style = docStyle || 'generic';

  return `You are an expert software engineer. Generate documentation for the following ${language} code.

**Documentation Style:** Use ${styleGuide[style]}.

**Response Format:**
1. First, provide ONLY the documentation comment (no code)
2. Then, briefly explain what was documented

**Documentation Guidelines:**
- Describe what the function/class does
- Document all parameters with types and descriptions
- Document return values
- Document any exceptions that may be thrown
- Include usage examples where helpful

\`\`\`${language}
${code}
\`\`\``;
}

/**
 * Build a follow-up chat prompt with context
 */
export function buildFollowUpPrompt(
  originalDiff: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  newQuestion: string,
  skills?: SkillContent[]
): { systemMessage: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const skillContext = buildSkillContext(skills);

  const systemMessage = `You are an expert code reviewer continuing a conversation about a code review.

**Original Diff Being Reviewed:**
\`\`\`diff
${originalDiff}
\`\`\`
${skillContext}
Answer follow-up questions about this code review. Be specific and reference the actual code when relevant.`;

  const messages = [
    ...conversationHistory,
    { role: 'user' as const, content: newQuestion },
  ];

  return { systemMessage, messages };
}
