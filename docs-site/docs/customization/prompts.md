# Customizing Prompts

You can tailor the AI's behavior by customizing the prompts used for code reviews and commit message generation.

## How to Customize

There are four ways to provide custom prompts and rules, listed in order of increasing priority:

1.  **VS Code Settings:** Edit the `ollama-code-review.prompt.review` or `ollama-code-review.prompt.commitMessage` settings.
2.  **Rules Directory (`.ollama-review/rules/`):** Place Markdown files containing team conventions in this directory.
3.  **Project Config File (`.ollama-review.yaml`):** Add this file to your workspace root to override settings and prompts.

## Rules Directory (`.ollama-review/rules/`)

For universal team conventions, you can create a `.ollama-review/rules/` directory at your workspace root. 

- **Format:** Plain Markdown (`.md`) files.
- **Workflow:** All files in this directory are concatenated and injected into the "Team Rules" section of every review prompt.
- **Example:** A file named `01-typescript.md` might contain:
    ```markdown
    - Always use TypeScript strict mode.
    - Never use the `any` type — use `unknown` and type guards.
    - Prefer named exports over default exports.
    ```
- **Ordering:** Files are sorted by filename, so you can use prefixes like `01-`, `02-` to control the order.

## Project Config (`.ollama-review.yaml`)

This file allows you to share consistent AI review settings across your whole team. It overrides both built-in defaults and VS Code `settings.json`.

### Supported Keys

```yaml
# Custom prompts
prompt:
  review: "..."
  commitMessage: "..."

# Frameworks list
frameworks:
  - React
  - TypeScript
  - Node.js

# Diff filter overrides
diffFilter:
  ignorePaths:
    - "**/generated/**"
  ignoreFormattingOnly: true
```

## Prompt Variables

You can use the following variables in your templates:

### Review Prompt
- `${code}`: The git diff or file content being reviewed.
- `${frameworks}`: The list of configured frameworks.
- `${skills}`: Content from active agent skills.
- `${profile}`: Context from the active review profile.

### Commit Message Prompt
- `${diff}`: The staged diff.
- `${draftMessage}`: The developer's draft message (if any).

## Example `.ollama-review.yaml`

```yaml
prompt:
  review: |
    You are an expert Senior Security Engineer. 
    Review the following diff for security vulnerabilities:
    
    ${code}
    
    Focus on:
    - OWASP Top 10
    - Input validation
    - Secret exposure
  
  commitMessage: |
    Generate a concise commit message in Conventional Commits format for:
    ${diff}
```

## Tips for Better Prompts

- **Be Specific:** Tell the AI exactly what you want it to focus on (e.g., "performance", "type safety").
- **Persona:** Give the AI a persona like "Senior React Developer" or "Security Auditor".
- **Format:** Specify the desired output format if you want something different from the default.
