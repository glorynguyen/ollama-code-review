# Smart Review Suggestions

After every code review, the extension analyzes your results and generates **contextual next-step suggestions** — intelligent recommendations that connect findings, profiles, trends, and workflow actions.

## How It Works

1. A review completes (staged, commit, PR, file, folder, agent, or comparison)
2. The suggestion engine analyzes findings, file patterns, score history, and active profile
3. Up to 5 actionable suggestions are generated and displayed as an information message
4. Click a suggestion to execute the recommended action directly

## Suggestion Categories

### Fix Suggestions

When findings have file and line references, the extension detects they are auto-fixable and recommends batch fixing:

- **"N findings are auto-fixable"** — Click to trigger the Fix All Findings command

Priority scales with count: 1 finding = low, 2–4 = medium, 5+ = high.

### Security Profile Suggestions

When files touching auth, session, token, password, or encryption logic are changed:

- **"Security-sensitive files detected"** — Recommends running a security-focused review
- Only appears when the current profile is not already `security`

### Performance Profile Suggestions

When database, cache, or query files are changed and performance issues are detected:

- **"Performance issues in database/cache files"** — Recommends a performance-focused re-review
- Only appears when the current profile is not already `performance`

### Profile Switch Suggestions

When the `general` profile is active but a specific category dominates (3+ issues):

- **"Consider using the 'security' profile"** — When security issues dominate
- **"Consider using the 'performance' profile"** — When performance issues dominate
- **"Consider using the 'strict' profile"** — When style issues dominate
- **"Consider using the 'accessibility' profile"** — When accessibility issues dominate

### Trend Suggestions

Based on your review score history (requires 3+ past reviews):

- **"Quality score declining"** — When the current score is 15+ points below your recent average
- **"Recurring issues in N files"** — When the same files appear in multiple low-scoring reviews

### Workflow Suggestions

- **"Code looks good — ready to commit"** — Score ≥ 90 with no critical or high findings
- **"N critical findings require attention"** — When critical findings are present

## Configuration

Smart suggestions are generated automatically after every review. No additional configuration is required — they use existing review data.

## Priority Ordering

Suggestions are sorted by priority (high → medium → low) so the most important action appears first. A maximum of 5 suggestions are shown to avoid overwhelming the user.

## Example

After reviewing changes to `src/auth/login.ts` and `src/database/pool.ts`:

```
💡 Security-sensitive files detected
   [Security-sensitive files detected] [3 findings are auto-fixable] [Quality score declining]
```

Clicking "Security-sensitive files detected" triggers a security-focused review. Clicking "3 findings are auto-fixable" opens the batch fix workflow.
