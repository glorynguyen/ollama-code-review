/**
 * F-020: Architecture Diagram Generation (Mermaid)
 *
 * Sends a code diff or file content to the AI model and asks it to produce a
 * valid Mermaid.js diagram that visualises the structure of the code.
 *
 * The diagram is rendered client-side in the review panel via Mermaid.js CDN.
 * A "Copy Diagram" button copies the raw Mermaid source to the clipboard.
 */

/** Result of a diagram generation request. */
export interface DiagramResult {
	/** Raw Mermaid source code. Empty string if generation failed. */
	mermaidCode: string;
	/** Detected diagram type (e.g., 'classDiagram', 'flowchart', 'sequenceDiagram'). */
	diagramType: string;
	/** Whether the model output was valid Mermaid syntax (basic check). */
	valid: boolean;
}

/** Known Mermaid diagram type keywords. */
const MERMAID_TYPES = [
	'classDiagram',
	'flowchart',
	'graph',
	'sequenceDiagram',
	'stateDiagram',
	'erDiagram',
	'journey',
	'gantt',
	'pie',
	'mindmap',
	'timeline',
	'block-beta',
	'C4Context',
	'gitGraph',
];

/**
 * Extract Mermaid code from the AI response.
 * The model may wrap it in a fenced code block or return it bare.
 */
function extractMermaidCode(response: string): string {
	// Try to extract from a ```mermaid fenced block
	const fencedMatch = response.match(/```mermaid\s*\n([\s\S]*?)```/i);
	if (fencedMatch) { return fencedMatch[1].trim(); }

	// Try a generic fenced block
	const genericMatch = response.match(/```\s*\n([\s\S]*?)```/);
	if (genericMatch) {
		const content = genericMatch[1].trim();
		// Verify it starts with a Mermaid keyword
		if (MERMAID_TYPES.some(t => content.startsWith(t))) {
			return content;
		}
	}

	// Check if the response itself starts with a Mermaid keyword
	const trimmed = response.trim();
	if (MERMAID_TYPES.some(t => trimmed.startsWith(t))) {
		return trimmed;
	}

	return '';
}

/** Detect the diagram type from the first line. */
function detectDiagramType(mermaidCode: string): string {
	const firstLine = mermaidCode.split('\n')[0].trim();
	for (const type of MERMAID_TYPES) {
		if (firstLine.startsWith(type)) { return type; }
	}
	return 'unknown';
}

/** Basic validity check: starts with a known keyword and has >1 line. */
function isValidMermaid(code: string): boolean {
	if (!code || code.split('\n').length < 2) { return false; }
	return MERMAID_TYPES.some(t => code.startsWith(t));
}

/**
 * Generate a Mermaid diagram from code content.
 *
 * @param codeContent - The diff or file content to visualise.
 * @param callAI - Function that sends a prompt to the current AI provider.
 * @returns The diagram result with Mermaid source code.
 */
export async function generateMermaidDiagram(
	codeContent: string,
	callAI: (prompt: string) => Promise<string>,
): Promise<DiagramResult> {
	// Truncate very large diffs to stay within token limits
	const truncated = codeContent.length > 12000
		? codeContent.substring(0, 12000) + '\n\n// ... (truncated for diagram generation)'
		: codeContent;

	const prompt = `You are an expert software architect. Generate a valid Mermaid.js diagram that visualizes the structure of the following code.

**Instructions:**
1. Choose the most appropriate diagram type:
   - **classDiagram** — for classes, interfaces, type relationships
   - **flowchart TD** — for function call chains, control flow, module dependencies
   - **sequenceDiagram** — for API calls, async patterns, request/response flows
   - **graph TD** — for import/module dependency graphs
2. Output ONLY the Mermaid diagram inside a \`\`\`mermaid code block.
3. Keep the diagram concise — focus on the most important relationships (max 20 nodes).
4. Use meaningful labels and group related elements.
5. Do NOT include any explanation or commentary outside the code block.

**Code to visualize:**
\`\`\`
${truncated}
\`\`\`

Output the Mermaid diagram now:`;

	const response = await callAI(prompt);
	const mermaidCode = extractMermaidCode(response);

	return {
		mermaidCode,
		diagramType: mermaidCode ? detectDiagramType(mermaidCode) : '',
		valid: isValidMermaid(mermaidCode),
	};
}
