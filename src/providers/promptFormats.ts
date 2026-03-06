import { STRUCTURED_REVIEW_SCHEMA_VERSION } from '../reviewFindings/types';
import type { GenerateOptions } from './types';

export function buildProviderPrompt(prompt: string, options?: GenerateOptions): string {
	if (options?.responseFormat !== 'structured-review') {
		return prompt;
	}

	return [
		prompt.trim(),
		'',
		'Return ONLY valid JSON. Do not include markdown fences, prose, or commentary outside the JSON object.',
		`The JSON must match schemaVersion "${STRUCTURED_REVIEW_SCHEMA_VERSION}" and this shape:`,
		'{',
		'  "schemaVersion": "1.0.0",',
		'  "summary": "short summary",',
		'  "findings": [',
		'    {',
		'      "id": "stable-id",',
		'      "severity": "critical|high|medium|low|info",',
		'      "title": "short title",',
		'      "summary": "clear explanation of the issue",',
		'      "confidence": 0.0,',
		'      "category": "optional category",',
		'      "anchor": { "file": "repo/relative/path.ts", "line": 12, "endLine": 12 },',
		'      "evidence": [',
		'        {',
		'          "kind": "diff|code|rule|context|test",',
		'          "summary": "why this is an issue",',
		'          "anchor": { "file": "repo/relative/path.ts", "line": 12 },',
		'          "quote": "optional short quote"',
		'        }',
		'      ],',
		'      "fix": {',
		'        "summary": "optional fix summary",',
		'        "replacement": "optional replacement snippet",',
		'        "patch": "optional patch text"',
		'      }',
		'    }',
		'  ]',
		'}',
		'Rules:',
		'- Use repo-relative file paths only.',
		'- Use new-file line numbers only.',
		'- If you are not confident in the exact file/line, omit the anchor instead of guessing.',
		'- Every finding must include at least one evidence item.',
		'- If there are no issues, return an empty findings array and a concise summary.',
	].join('\n');
}
