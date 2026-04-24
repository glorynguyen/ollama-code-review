# Customizing Prompts

You can tailor the AI's behavior by customizing the prompts used for code reviews and commit message generation.

## How to Customize

There are three ways to provide custom prompts, listed in order of increasing priority:

1.  **VS Code Settings:** Edit the `ollama-code-review.prompt.review` or `ollama-code-review.prompt.commitMessage` settings in your `settings.json`.
2.  **Project Config File:** Add a `.ollama-review.yaml` file to your workspace root. This is great for sharing prompts with your team.

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
