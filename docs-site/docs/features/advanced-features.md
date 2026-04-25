# Advanced Features

Take your code reviews to the next level with these powerful tools.

## Agentic Multi-Step Reviews

Go beyond single-pass reviews with a 5-step AI pipeline:
1.  **Analyze Diff:** Classify changes and line counts.
2.  **Gather Context:** Resolve imports and related tests.
3.  **Pattern Analysis:** Identify codebase conventions.
4.  **Deep Review:** Comprehensive analysis with full context.
5.  **Synthesis:** Self-critique to remove false positives.

### Agentic Workspace Editing

When using agentic models (like **Claude 3.7 Sonnet** or **v0**), the AI can autonomously **create, update, or delete files** in your workspace to implement suggested changes.

- **Safety First:** A confirmation dialog appears in VS Code before any file modification. You can review the path and action before approving.
- **Manual Control:** Every code block in the chat history features a **Create** button to manually save snippets to files.

## Agent Skills

Enhance your code reviews by applying specialized "skills" (e.g., "Security Auditor," "Performance Expert").

- **Library:** Download skills from GitHub (default: `vercel-labs/agent-skills`).
- **Multi-Skill Selection:** You can select and apply multiple skills simultaneously to a single review.
- **Workflow:** Use `Browse Agent Skills` to download and `Apply Skills to Review` to select which ones to use.

## Architecture Diagrams

Generate visual Mermaid.js diagrams from your code changes.
- **Trigger:** Click the **📊 Diagram** button in the review panel.
- **Types:** Class diagrams, flowcharts, sequence diagrams, and dependency graphs.

## Semantic Version Bump Advisor

Instantly determine the right semantic version bump for your next release.
- **Command:** `Ollama Code Review: Suggest Version Bump`.
- **Logic:** The AI analyzes your changes for breaking changes (MAJOR), new features (MINOR), or bug fixes (PATCH).
- **Auto-Update:** If a `package.json` is found, you can apply the version change directly.

## Contentstack Schema Validation

Validate Contentstack CMS field names used in your source code against actual Content Type schemas.
- **How it works:** The extension fetches schemas from the Contentstack API or a local JSON export and flags mismatched field names.
- **Suggestions:** Provides Levenshtein-distance-based spelling suggestions for mismatched fields.

## Scan for Secrets

Detect accidentally committed secrets (API keys, tokens, passwords, private keys) in your staged changes or files before they reach your repository.
- **Command:** `Ollama Code Review: Scan for Secrets`.
- **Logic:** Uses regex pattern detection combined with Shannon entropy filtering to suppress false positives.

## Impact Analysis & API Guard

Analyze the downstream impact of your changes before you commit.
- **API Change Detection:** Detects changes to function signatures, exported constants, and interface definitions.
- **Downstream Impact Graph:** Visualizes which files and modules depend on the modified code.
- **API Guard:** Status bar alerts and notifications when high-impact API changes are detected.

## RAG-Enhanced Reviews

Boost review quality by automatically retrieving similar code from your indexed codebase and injecting it as additional context.
- **Command:** `Ollama Code Review: Index Codebase`

## Team Knowledge Base

Encode your team's architecture decisions and coding patterns in a `.ollama-review-knowledge.yaml` file. The AI references these entries during every review to ensure consistency.

## Compliance Profiles

Focus the AI on specific standards:
- **Security:** OWASP Top 10, NIST CSF.
- **Regulatory:** GDPR, HIPAA, PCI-DSS, SOC 2.
- **General:** Performance, Accessibility, Educational, Strict.
