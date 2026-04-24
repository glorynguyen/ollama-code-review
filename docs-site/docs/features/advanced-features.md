# Advanced Features

Take your code reviews to the next level with these powerful tools.

## Agentic Multi-Step Reviews

Go beyond single-pass reviews with a 5-step AI pipeline:
1.  **Analyze Diff:** Classify changes and line counts.
2.  **Gather Context:** Resolve imports and related tests.
3.  **Pattern Analysis:** Identify codebase conventions.
4.  **Deep Review:** Comprehensive analysis with full context.
5.  **Synthesis:** Self-critique to remove false positives.

## Architecture Diagrams

Generate visual Mermaid.js diagrams from your code changes.
- **Trigger:** Click the **📊 Diagram** button in the review panel.
- **Types:** Class diagrams, flowcharts, sequence diagrams, and dependency graphs.

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
