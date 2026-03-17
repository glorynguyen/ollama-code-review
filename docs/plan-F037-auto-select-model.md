# F-037 · Auto-detect & Suggest the Best Model — Technical Plan

> **Target implementer:** Haiku 4.5
> **Feature ID:** F-037
> **Complexity:** Medium | **Impact:** High
> **Prerequisites:** F-025 (Provider Abstraction Layer — shipped)

---

## 1. Selection Logic — Heuristic Design

The recommender runs **before** the AI call and produces a ranked list of models. It evaluates four orthogonal signals and combines them into a single weighted score per candidate model.

### 1.1 Signal Definitions

| Signal | Weight | Source | Computation |
|--------|--------|--------|-------------|
| **Task type** | 0.35 | Command ID being executed | Enum lookup → per-model affinity score (0–1) |
| **Language** | 0.20 | File extension(s) from diff or active editor | Keyword map → per-model affinity score (0–1) |
| **Diff size** | 0.25 | Character count of filtered diff | Bucket into `small` (<2 KB), `medium` (2–20 KB), `large` (>20 KB) → per-model affinity |
| **Profile** | 0.20 | Active review profile name (e.g., `security`, `performance`) | Profile → per-model affinity score (0–1) |

**Final score per model** = Σ (signal_weight × affinity[signal][model])

### 1.2 Task Type Taxonomy

```typescript
type TaskType =
  | 'review'           // reviewChanges, reviewCommit, reviewCommitRange, reviewChangesBetweenTwoBranches
  | 'commit-message'   // generateCommitMessage
  | 'explain'          // explainCode
  | 'generate-tests'   // generateTests
  | 'fix'              // fixIssue, fixSelection, fixFinding
  | 'document'         // addDocumentation
  | 'diagram'          // generateDiagram
  | 'agent-review'     // agentReview
  | 'compare'          // compareModels (excluded — user picks models manually)
  | 'version-bump'     // suggestVersionBump
  | 'file-review'      // reviewFile, reviewFolder, reviewSelection
  ;
```

### 1.3 Model Capability Tiers

Each known model is classified into a tier that drives default affinities:

| Tier | Models | Strengths |
|------|--------|-----------|
| `flagship` | `claude-opus-4-*`, `gemini-2.5-pro`, `mistral-large-latest`, `qwen3-coder:480b-cloud` | Deep reasoning, security audits, large diffs |
| `balanced` | `claude-sonnet-4-*`, `claude-3-7-sonnet-*`, `codestral-latest`, `kimi-k2.5:cloud` | Good all-rounder, moderate cost |
| `fast` | `gemini-2.5-flash`, `glm-4.7-flash`, `mistral-small-latest`, `MiniMax-M2.5` | Quick tasks, small diffs, commit messages |
| `code-specialist` | `codestral-latest`, local Ollama `*coder*` models, `huggingface` (Qwen-Coder) | Code generation, tests, fixes |
| `local` | Any Ollama model not matching above | Privacy, offline, variable capability |

### 1.4 Affinity Matrix (excerpt)

```
                        flagship  balanced  fast  code-specialist  local
task:review               0.9       0.7     0.4       0.6          0.5
task:commit-message       0.3       0.5     0.9       0.5          0.7
task:explain              0.7       0.8     0.6       0.5          0.5
task:generate-tests       0.5       0.6     0.4       0.9          0.6
task:fix                  0.6       0.7     0.5       0.9          0.5
task:agent-review         1.0       0.6     0.2       0.5          0.3
task:diagram              0.5       0.7     0.6       0.4          0.4
task:document             0.4       0.6     0.7       0.7          0.5

size:small                0.3       0.6     0.9       0.7          0.8
size:medium               0.7       0.8     0.6       0.7          0.6
size:large                1.0       0.6     0.3       0.5          0.3

profile:security          1.0       0.6     0.2       0.4          0.3
profile:performance       0.7       0.7     0.4       0.6          0.4
profile:general           0.5       0.8     0.7       0.6          0.7
```

### 1.5 Availability Filtering

Before scoring, prune candidates to models that are actually usable:
1. Check if the required API key is configured (non-empty string in settings).
2. For Ollama models, check if they appear in the `/api/tags` response (cached from last model picker open or startup).
3. For `openai-compatible`, check if `openaiCompatible.endpoint` and `openaiCompatible.model` are set.
4. Models without a configured key/endpoint get score = 0 (filtered out).

---

## 2. Interface Definitions

All types go in a new file: **`src/modelAdvisor/types.ts`**

```typescript
/** Task the user is about to perform */
export type TaskType =
  | 'review'
  | 'commit-message'
  | 'explain'
  | 'generate-tests'
  | 'fix'
  | 'document'
  | 'diagram'
  | 'agent-review'
  | 'version-bump'
  | 'file-review';

/** Diff size bucket */
export type DiffSizeBucket = 'small' | 'medium' | 'large';

/** Capability tier for a known model */
export type ModelTier = 'flagship' | 'balanced' | 'fast' | 'code-specialist' | 'local';

/** Input to the recommendation engine */
export interface ModelAdvisorInput {
  /** Which command is about to run */
  taskType: TaskType;
  /** Primary file extensions in the diff/selection (e.g., ['ts', 'tsx']) */
  languages: string[];
  /** Character count of the diff/code being sent */
  contentLength: number;
  /** Active review profile name, if any (e.g., 'security', 'general') */
  activeProfile?: string;
}

/** Single model recommendation */
export interface ModelSuggestion {
  /** Model identifier as stored in settings (e.g., 'claude-opus-4-20250514') */
  modelId: string;
  /** Provider name from ProviderRegistry */
  providerName: string;
  /** Human-readable reason for the suggestion (shown in QuickPick) */
  reason: string;
  /** Composite score 0–1 */
  score: number;
  /** Capability tier */
  tier: ModelTier;
}

/** Output from the recommendation engine */
export interface ModelAdvisorResult {
  /** Top recommendation */
  recommended: ModelSuggestion;
  /** All scored candidates, descending by score (max 5) */
  alternatives: ModelSuggestion[];
  /** Whether auto-select is enabled in settings */
  autoSelect: boolean;
}

/** Static metadata about a known model */
export interface ModelProfile {
  modelId: string;
  providerName: string;
  tier: ModelTier;
  /** Language affinities: extension → bonus score (0–0.3) */
  languageBonus?: Record<string, number>;
}
```

---

## 3. Step-by-Step Implementation

### Task 1: Create `src/modelAdvisor/types.ts`
- Copy the interface definitions from §2 verbatim.
- Export all types.

### Task 2: Create `src/modelAdvisor/profiles.ts` — Model Metadata Registry
- Export `const MODEL_PROFILES: ModelProfile[]` containing entries for every known cloud model (15 models from `selectModel` command) plus a catch-all for Ollama locals.
- Export `function classifyOllamaModel(name: string): ModelTier` — pattern-match model names (`*coder*` → `code-specialist`, `*llama*70b*` → `flagship`, else → `local`).
- Export `const TIER_TASK_AFFINITY: Record<ModelTier, Record<TaskType, number>>` — the affinity matrix from §1.4.
- Export `const TIER_SIZE_AFFINITY: Record<ModelTier, Record<DiffSizeBucket, number>>` — size affinities.
- Export `const PROFILE_TIER_AFFINITY: Record<string, Record<ModelTier, number>>` — profile affinities (`security`, `performance`, `general`, `compliance-*`; default `general` for unknown profiles).

### Task 3: Create `src/modelAdvisor/advisor.ts` — Core Scoring Engine
- Export `function bucketDiffSize(charCount: number): DiffSizeBucket` — thresholds: `<2000` → small, `<20000` → medium, else large.
- Export `function scoreModel(profile: ModelProfile, input: ModelAdvisorInput): { score: number; reason: string }`:
  1. Look up `TIER_TASK_AFFINITY[profile.tier][input.taskType]` → `taskScore`.
  2. Look up `TIER_SIZE_AFFINITY[profile.tier][bucketDiffSize(input.contentLength)]` → `sizeScore`.
  3. Look up `PROFILE_TIER_AFFINITY[input.activeProfile ?? 'general'][profile.tier]` → `profileScore`.
  4. Compute `languageScore`: if `profile.languageBonus` has any of `input.languages`, take the max bonus; else 0.5 (neutral).
  5. `finalScore = 0.35 * taskScore + 0.25 * sizeScore + 0.20 * profileScore + 0.20 * languageScore`.
  6. Build `reason` string: pick the dominant signal (highest weighted contribution) and phrase it (e.g., "Best for security reviews of large diffs").
- Export `async function getModelRecommendation(input: ModelAdvisorInput, config: vscode.WorkspaceConfiguration): Promise<ModelAdvisorResult>`:
  1. Read `autoSelect` from `config.get<boolean>('autoSelectModel', false)`.
  2. Build candidate list: iterate `MODEL_PROFILES`, filter by availability (check API key settings non-empty).
  3. Fetch Ollama `/api/tags` (with 3s timeout, catch errors → empty list). For each Ollama model, call `classifyOllamaModel()` to create a `ModelProfile`.
  4. Score each candidate via `scoreModel()`.
  5. Sort descending. Return top as `recommended`, next 4 as `alternatives`.

### Task 4: Create `src/modelAdvisor/index.ts` — Barrel exports
- Re-export all public types and functions from `types.ts`, `profiles.ts`, `advisor.ts`.

### Task 5: Register VS Code setting `autoSelectModel`
In `package.json`, under `contributes.configuration.properties`:
```json
"ollama-code-review.autoSelectModel": {
  "type": "boolean",
  "default": false,
  "description": "Automatically select the recommended AI model for each task based on diff size, language, and task type."
}
```

### Task 6: Integrate into model picker (`src/commands/index.ts`)
In the `selectModel` command handler (line ~701):
1. Import `getModelRecommendation` and `ModelAdvisorInput`.
2. Before showing QuickPick, call `getModelRecommendation()` with a `taskType` of `'review'` (default context) and `languages` from the active editor.
3. If `result.recommended` exists, prepend a QuickPick item:
   ```
   { label: result.recommended.modelId,
     description: `⭐ Recommended — ${result.recommended.reason}`,
     detail: `Score: ${(result.recommended.score * 100).toFixed(0)}%` }
   ```
4. Mark the recommended item with `picked: true` if `autoSelect` is false (highlight, don't auto-confirm).

### Task 7: Integrate into review entry points
In `runReview()` and other command handlers that call the AI:
1. Build a `ModelAdvisorInput` from the current context (task type from command ID, languages from diff, content length from filtered diff).
2. If `autoSelectModel` is `true` and the user hasn't explicitly picked a model in this session, override the configured model with `result.recommended.modelId`.
3. Show a brief status bar notification: `"Auto-selected: {modelId} ({reason})"` for 5 seconds.

### Task 8: Map command IDs to `TaskType`
Export a helper in `src/modelAdvisor/advisor.ts`:
```typescript
export function commandToTaskType(commandId: string): TaskType {
  const map: Record<string, TaskType> = {
    'ollama-code-review.reviewChanges': 'review',
    'ollama-code-review.reviewCommit': 'review',
    'ollama-code-review.reviewCommitRange': 'review',
    'ollama-code-review.reviewChangesBetweenTwoBranches': 'review',
    'ollama-code-review.generateCommitMessage': 'commit-message',
    'ollama-code-review.explainCode': 'explain',
    'ollama-code-review.generateTests': 'generate-tests',
    'ollama-code-review.fixIssue': 'fix',
    'ollama-code-review.fixSelection': 'fix',
    'ollama-code-review.fixFinding': 'fix',
    'ollama-code-review.addDocumentation': 'document',
    'ollama-code-review.generateDiagram': 'diagram',
    'ollama-code-review.agentReview': 'agent-review',
    'ollama-code-review.suggestVersionBump': 'version-bump',
    'ollama-code-review.reviewFile': 'file-review',
    'ollama-code-review.reviewFolder': 'file-review',
    'ollama-code-review.reviewSelection': 'file-review',
  };
  return map[commandId] ?? 'review';
}
```

### Task 9: Extract languages from diff
Export in `src/modelAdvisor/advisor.ts`:
```typescript
export function extractLanguagesFromDiff(diff: string): string[] {
  const filePattern = /^(?:diff --git a\/.*?\.(\w+)|[-+]{3} [ab]\/.*?\.(\w+))/gm;
  const exts = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(diff)) !== null) {
    const ext = match[1] || match[2];
    if (ext) { exts.add(ext.toLowerCase()); }
  }
  return [...exts];
}
```

### Task 10: Unit tests — `src/test/modelAdvisor.test.ts`
- Test `bucketDiffSize()` with boundary values (1999, 2000, 19999, 20000).
- Test `classifyOllamaModel()` with `qwen2.5-coder:14b` → `code-specialist`, `llama3:70b` → `flagship`, `phi3:mini` → `local`.
- Test `scoreModel()` with the dry run example from §4.
- Test `commandToTaskType()` mapping.
- Test `extractLanguagesFromDiff()` with a sample diff.
- Test availability filtering: model with no API key → excluded.

---

## 4. Dry Run Example

**Input:**

```typescript
const input: ModelAdvisorInput = {
  taskType: 'review',
  languages: ['ts', 'tsx'],
  contentLength: 8500,    // medium bucket
  activeProfile: 'security',
};
```

**Available models** (API keys configured): `claude-opus-4-20250514`, `gemini-2.5-flash`, `codestral-latest`.

**Scoring:**

| Model | Tier | Task (×0.35) | Size (×0.25) | Profile (×0.20) | Lang (×0.20) | **Total** |
|-------|------|-------------|-------------|----------------|-------------|-----------|
| `claude-opus-4-20250514` | flagship | 0.9 × 0.35 = 0.315 | 0.7 × 0.25 = 0.175 | 1.0 × 0.20 = 0.200 | 0.6 × 0.20 = 0.120 | **0.810** |
| `codestral-latest` | code-specialist | 0.6 × 0.35 = 0.210 | 0.7 × 0.25 = 0.175 | 0.4 × 0.20 = 0.080 | 0.7 × 0.20 = 0.140 | **0.605** |
| `gemini-2.5-flash` | fast | 0.4 × 0.35 = 0.140 | 0.6 × 0.25 = 0.150 | 0.2 × 0.20 = 0.040 | 0.5 × 0.20 = 0.100 | **0.430** |

**Expected output:**

```typescript
const result: ModelAdvisorResult = {
  recommended: {
    modelId: 'claude-opus-4-20250514',
    providerName: 'claude',
    reason: 'Best for security reviews of medium diffs',
    score: 0.81,
    tier: 'flagship',
  },
  alternatives: [
    {
      modelId: 'codestral-latest',
      providerName: 'mistral',
      reason: 'Strong code specialist for TypeScript',
      score: 0.605,
      tier: 'code-specialist',
    },
    {
      modelId: 'gemini-2.5-flash',
      providerName: 'gemini',
      reason: 'Fast option for quick reviews',
      score: 0.43,
      tier: 'fast',
    },
  ],
  autoSelect: false,
};
```

**Unit test assertion:**

```typescript
it('recommends claude-opus for security review of medium TS diff', () => {
  const input: ModelAdvisorInput = {
    taskType: 'review',
    languages: ['ts', 'tsx'],
    contentLength: 8500,
    activeProfile: 'security',
  };
  const candidates: ModelProfile[] = [
    { modelId: 'claude-opus-4-20250514', providerName: 'claude', tier: 'flagship' },
    { modelId: 'gemini-2.5-flash', providerName: 'gemini', tier: 'fast' },
    { modelId: 'codestral-latest', providerName: 'mistral', tier: 'code-specialist' },
  ];
  const scores = candidates.map(c => ({ ...c, ...scoreModel(c, input) }));
  scores.sort((a, b) => b.score - a.score);
  assert.strictEqual(scores[0].modelId, 'claude-opus-4-20250514');
  assert.ok(scores[0].score > 0.75, `Expected >0.75, got ${scores[0].score}`);
});
```

---

## 5. New File Manifest

| File | Purpose | LOC est. |
|------|---------|----------|
| `src/modelAdvisor/types.ts` | Type definitions | ~60 |
| `src/modelAdvisor/profiles.ts` | Model metadata, affinity matrices | ~120 |
| `src/modelAdvisor/advisor.ts` | Scoring engine, availability check, helpers | ~150 |
| `src/modelAdvisor/index.ts` | Barrel exports | ~10 |
| `src/test/modelAdvisor.test.ts` | Unit tests | ~100 |

**Modified files:**
- `package.json` — add `autoSelectModel` setting
- `src/commands/index.ts` — integrate into `selectModel` command and review entry points

---

## 6. Setting

```jsonc
// package.json contributes.configuration.properties
"ollama-code-review.autoSelectModel": {
  "type": "boolean",
  "default": false,
  "description": "Automatically select the recommended AI model for each task based on diff size, language, and task type."
}
```

When `false` (default): the model picker shows a `⭐ Recommended` badge on the top suggestion. User still picks manually.
When `true`: the extension silently overrides the configured model with the top recommendation and shows a 5-second status bar message.
