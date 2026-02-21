import * as vscode from 'vscode';
import axios from 'axios';
import { getOllamaModel } from '../utils';
import { parseCodeResponse } from '../codeActions';
import {
	isClaudeModel,
	isGlmModel,
	isHuggingFaceModel,
	isGeminiModel,
	isMistralModel,
	isMiniMaxModel,
	isOpenAICompatibleModel,
	callClaudeAPI,
	callGlmAPI,
	callHuggingFaceAPI,
	callGeminiAPI,
	callMistralAPI,
	callMiniMaxAPI,
	callOpenAICompatibleAPI,
} from './providerClients';

export async function getOllamaSuggestion(codeSnippet: string, languageId: string): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.3);

	const prompt = `
		You are an expert software engineer specializing in writing clean, efficient, and maintainable code.
		Your task is to analyze the following ${languageId} code snippet and provide a refactored or improved version.

		**IMPORTANT:** Your response MUST follow this structure exactly:
		1.  Start your response with the refactored code inside a markdown code block (e.g., \`\`\`${languageId}\n...\n\`\`\`).
		2.  IMMEDIATELY after the code block, provide a clear, bulleted list explaining the key improvements you made.

		If the code is already well-written and you have no suggestions, respond with the single sentence: "The selected code is well-written and I have no suggestions for improvement."

		Here is the code to refactor:
		---
		${codeSnippet}
		---
	`;

	try {
		// Use Claude API if a Claude model is selected
		if (isClaudeModel(model)) {
			return await callClaudeAPI(prompt, config);
		}

		// Use GLM API if a GLM model is selected
		if (isGlmModel(model)) {
			return await callGlmAPI(prompt, config);
		}

		// Use Hugging Face API if huggingface is selected
		if (isHuggingFaceModel(model)) {
			return await callHuggingFaceAPI(prompt, config);
		}

		// Use Gemini API if a Gemini model is selected
		if (isGeminiModel(model)) {
			return await callGeminiAPI(prompt, config);
		}

		// Use Mistral API if a Mistral model is selected
		if (isMistralModel(model)) {
			return await callMistralAPI(prompt, config);
		}

		// Use MiniMax API if a MiniMax model is selected
		if (isMiniMaxModel(model)) {
			return await callMiniMaxAPI(prompt, config);
		}

		// Use OpenAI-compatible API if selected
		if (isOpenAICompatibleModel(model)) {
			return await callOpenAICompatibleAPI(prompt, config);
		}

		// Otherwise use Ollama API
		const response = await axios.post(endpoint, {
			model: model,
			prompt: prompt,
			stream: false,
			options: { temperature }
		});
		return response.data.response.trim();
	} catch (error) {
		throw error;
	}
}

/**
 * Get detailed explanation for a code snippet (F-005)
 */
export async function getExplanation(codeSnippet: string, languageId: string): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.2);

	const prompt = `
You are an expert software engineer and educator. Your task is to explain the following ${languageId} code in detail.

**Instructions:**
1. Start with a brief summary of what the code does (1-2 sentences).
2. Explain the code step by step, breaking down each important part.
3. Highlight any patterns, algorithms, or design decisions used.
4. Note any potential issues, edge cases, or areas for improvement.
5. If relevant, explain how this code might interact with other parts of a system.

**Code to explain:**
\`\`\`${languageId}
${codeSnippet}
\`\`\`

Provide your explanation in clear Markdown format.
`;

	return callAIProvider(prompt, config, model, endpoint, temperature);
}

/**
 * Generate unit tests for code (F-005)
 */
export async function generateTests(codeSnippet: string, languageId: string, testFramework: string): Promise<{ code: string; explanation: string }> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.3);

	const prompt = `
You are an expert software engineer specializing in testing. Generate comprehensive unit tests for the following ${languageId} code using ${testFramework}.

**Instructions:**
1. Create test cases that cover the main functionality.
2. Include edge cases and error scenarios.
3. Use descriptive test names that explain what is being tested.
4. Follow ${testFramework} best practices and conventions.
5. Include necessary imports and setup.

**IMPORTANT:** Your response MUST follow this structure exactly:
1. Start with the test code inside a markdown code block (e.g., \`\`\`${languageId}\n...\n\`\`\`).
2. After the code block, provide a bulleted list explaining what each test covers.

**Code to test:**
\`\`\`${languageId}
${codeSnippet}
\`\`\`

Generate the tests now.
`;

	const response = await callAIProvider(prompt, config, model, endpoint, temperature);
	const parsed = parseCodeResponse(response);

	if (parsed) {
		return parsed;
	}

	return { code: response, explanation: 'Tests generated successfully.' };
}

/**
 * Generate a fix for an issue (F-005)
 */
export async function generateFix(codeSnippet: string, issue: string, languageId: string): Promise<{ code: string; explanation: string }> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.2);

	const prompt = `
You are an expert software engineer. Fix the following issue in the ${languageId} code.

**Issue to fix:** ${issue}

**IMPORTANT:** Your response MUST follow this structure exactly:
1. Start with the fixed code inside a markdown code block (e.g., \`\`\`${languageId}\n...\n\`\`\`).
2. After the code block, explain what was wrong and how you fixed it.

**Code with issue:**
\`\`\`${languageId}
${codeSnippet}
\`\`\`

Provide the fixed code now.
`;

	const response = await callAIProvider(prompt, config, model, endpoint, temperature);
	const parsed = parseCodeResponse(response);

	if (parsed) {
		return parsed;
	}

	return { code: response, explanation: 'Fix applied.' };
}

/**
 * Generate documentation for code (F-005)
 */
export async function generateDocumentation(codeSnippet: string, languageId: string, docStyle: string): Promise<{ code: string; explanation: string }> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.2);

	const styleGuide = {
		jsdoc: 'JSDoc format with @param, @returns, @throws, @example tags',
		tsdoc: 'TSDoc format with @param, @returns, @throws, @example, and TypeScript-specific tags',
		pydoc: 'Python docstring format with Args, Returns, Raises, Examples sections',
		generic: 'Standard documentation comment format for the language'
	};

	const prompt = `
You are an expert technical writer. Generate documentation for the following ${languageId} code.

**Documentation style:** ${styleGuide[docStyle as keyof typeof styleGuide]}

**Instructions:**
1. Document the purpose of the function/class.
2. Document all parameters with their types and descriptions.
3. Document the return value if applicable.
4. Document any exceptions/errors that may be thrown.
5. Include a brief example if helpful.

**IMPORTANT:** Your response MUST follow this structure exactly:
1. Start with ONLY the documentation comment (no code) inside a markdown code block.
2. After the code block, briefly explain what you documented.

**Code to document:**
\`\`\`${languageId}
${codeSnippet}
\`\`\`

Generate the documentation comment now.
`;

	const response = await callAIProvider(prompt, config, model, endpoint, temperature);
	const parsed = parseCodeResponse(response);

	if (parsed) {
		return parsed;
	}

	return { code: response, explanation: 'Documentation generated.' };
}

/**
 * Helper function to call the appropriate AI provider
 */
export async function callAIProvider(prompt: string, config: vscode.WorkspaceConfiguration, model: string, endpoint: string, temperature: number): Promise<string> {
	if (isClaudeModel(model)) {
		return await callClaudeAPI(prompt, config);
	}

	if (isGlmModel(model)) {
		return await callGlmAPI(prompt, config);
	}

	if (isHuggingFaceModel(model)) {
		return await callHuggingFaceAPI(prompt, config);
	}

	if (isGeminiModel(model)) {
		return await callGeminiAPI(prompt, config);
	}

	if (isMistralModel(model)) {
		return await callMistralAPI(prompt, config);
	}

	if (isMiniMaxModel(model)) {
		return await callMiniMaxAPI(prompt, config);
	}

	if (isOpenAICompatibleModel(model)) {
		return await callOpenAICompatibleAPI(prompt, config);
	}

	// Default to Ollama API
	const response = await axios.post(endpoint, {
		model: model,
		prompt: prompt,
		stream: false,
		options: { temperature }
	});
	return response.data.response.trim();
}
