# AI Release Orchestrator

The **AI Release Orchestrator** helps you build release branches from selected commits while keeping the work mapped to Azure DevOps tickets. It compares source and target branches, filters out commits that are already present, groups the remaining work into a release draft, and can create or update release branches with guided cherry-picking.

## What it does

### Branch comparison

Choose a **source** branch and **target** branch from the header, then run **Compare**. The orchestrator:

- reads commits from the source branch that are not in the target branch;
- filters commits that are already present by content or matching commit message;
- skips commits with no code changes;
- limits the active candidate list to the first 50 commits;
- extracts work item IDs from commit bodies that contain `#123` style references;
- shows each commit diff in the panel or in a temporary diff editor.

The target branch defaults to `ollama-code-review.defaultBaseBranch`, which is `main` unless you change it.

### Release draft

Use the release draft to turn branch differences into a planned release:

- search Azure DevOps work items by ID or title;
- add manual placeholder tickets when a release item does not have an ADO ticket;
- drag commits from the unassigned pool into ticket buckets;
- right-click commits to copy the full hash, copy the commit body, copy the filtered diff, or mark the commit unavailable;
- filter the commit pool to show all commits or only pickable commits;
- copy a local `git cherry-pick ...` command for the planned commits.

Draft mappings and commit availability are saved in VS Code workspace state, scoped to the target branch where applicable.

### Azure DevOps context

When Azure DevOps is configured, the panel can:

- save a PAT securely in VS Code Secrets;
- test the connection against the configured repository;
- look up work item title, state, type, and description;
- search active work items by title;
- load pull requests targeting the selected target branch;
- copy a PR diff for AI review or release-note preparation;
- build an AI release-note prompt from selected ticket details and copy it to the clipboard.

### Release branch creation

When the plan is ready, choose **Create Release**, enter a branch name, and confirm. The orchestrator:

- fetches `origin/<targetBranch>`;
- creates the new branch from `origin/<targetBranch>`;
- cherry-picks planned commits in chronological order;
- checks for dependency risk before running unless you explicitly confirm;
- records the created release in local release history.

Dependency risk analysis warns when a selected commit touches a file that was also touched by an earlier skipped commit.

### Conflict handling

If a cherry-pick conflict happens, the orchestrator opens a conflict modal instead of abandoning the flow. You can:

- review the conflicting files and current file contents;
- edit the resolved content directly in the panel;
- mark each file resolved, which stages it with `git add`;
- continue the remaining cherry-picks after all conflicts are resolved;
- abort the cherry-pick when needed.

### Release history

Created releases appear under **Active Releases**. From there you can:

- review the recorded commit list;
- save Markdown release notes;
- delete local release history without deleting the Git branch;
- drag a new commit onto an existing release to append it with another cherry-pick.

## Setup

1. Open a Git workspace in VS Code.
2. Configure Azure DevOps settings:

| Setting | Description |
|---------|-------------|
| `ollama-code-review.ado.orgUrl` | Azure DevOps organization URL, for example `https://dev.azure.com/yourorg`. |
| `ollama-code-review.ado.project` | Azure DevOps project name. |
| `ollama-code-review.ado.repoId` | Azure DevOps repository ID, GUID, or repository name. |

3. Save an Azure DevOps PAT using either:

- `Ollama Code Review: Set Azure DevOps Personal Access Token`
- the **ADO** status chip inside the Release Orchestrator panel

The PAT can be a raw token or an already Base64-encoded Basic token value. It is stored in VS Code Secrets.

Recommended PAT scopes:

- `Work Items: Read` for ticket lookup and search;
- `Code: Read` for repository and pull request lookup.

Cherry-picking itself runs through your local Git checkout, so release creation uses your local Git credentials.

## Workflow

1. Run `Ollama Code Review: Open AI Release Orchestrator`.
2. Use the source and target branch chips to select the comparison.
3. Click **Compare** to load candidate commits.
4. Connect Azure DevOps, or add manual ticket placeholders.
5. Drag commits into the relevant ticket buckets.
6. Use **AI Notes** to copy a release-note prompt, or **Copy Command** to copy a local cherry-pick command.
7. Click **Create Release**, enter the release branch name, and confirm.
8. Resolve any conflicts in the conflict modal, or abort if the branch should not be created.
9. Add release notes in **Active Releases** after the branch is created.

## Best practices

- Include ADO work item references such as `#123` in commit bodies so commits can auto-map to tickets.
- Keep commits focused so dependency warnings and cherry-pick conflicts are easier to reason about.
- Compare against the exact branch that will receive the release.
- Review the copied cherry-pick command before using it outside the panel.
- Treat **Mark as Unavailable** as a planning aid only. It hides work from pickable views but does not change Git history.
- Resolve conflicts carefully. The panel writes the resolved file content and stages it before continuing the cherry-pick.
