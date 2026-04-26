# AI Release Orchestrator

The **AI Release Orchestrator** is a powerful tool designed to streamline the complex process of staging changes and creating release branches. It bridges the gap between your Git commits and your project management tool (Azure DevOps), helping you ensure that every release is complete, mapped to business value, and safe to deploy.

## Key Features

### 1. Commit-to-Ticket Mapping
Automatically group Git commits by Azure DevOps work items. The orchestrator analyzes commit messages and metadata to suggest mappings, allowing you to visualize exactly which features and bug fixes are included in a release.

- **Drag-and-Drop Interface:** Easily move commits between ticket "buckets" or back to the unassigned pool.
- **ADO Integration:** Real-time lookup of ticket titles, states, and descriptions.
- **Search:** Find specific tickets by ID or title directly from the dashboard.

### 2. Dependency Risk Analysis
Before you create a release, the AI analyzes the selected commits for potential risks:
- **Missing Dependencies:** Identifies if a selected commit depends on other code that hasn't been included in the release plan.
- **Cherry-pick Conflicts:** Predicts potential merge conflicts based on branch history.
- **Impact Assessment:** Summarizes the architectural impact of the combined changes.

### 3. Automated Release Creation
Once your plan is finalized, the Orchestrator automates the heavy lifting:
- **Cherry-picking:** Executes the cherry-pick operations for all selected commits in the correct order.
- **Branch Management:** Creates a new release branch (e.g., `release/v1.2.0`) based on your target branch.
- **History Tracking:** Saves your release mappings and notes locally to help with future release cycles or generated change logs.

## Getting Started

### Prerequisites
1. **Git Repository:** You must have a Git repository initialized in your workspace.
2. **Azure DevOps PAT:** To enable ticket lookups, you'll need an Azure DevOps Personal Access Token (PAT) with `Work Items: Read` scope.

### Setup
1. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run `Ollama Code Review: Open AI Release Orchestrator`.
3. If prompted, set your Azure DevOps token using `Ollama Code Review: Set ADO Token`.
4. Configure your ADO Organization URL and Project in VS Code Settings under `Ollama Code Review > Ado`.

## Workflow

1. **Select Branches:** Choose your **Source** branch (where the work was done, e.g., `develop`) and **Target** branch (where the release will go, e.g., `main`).
2. **Assign Commits:** Drag commits from the left-hand pool into ticket buckets. You can create new buckets by searching for ticket IDs.
3. **Review Risks:** Click **Analyze Risks** to have the AI check for missing dependencies or potential conflicts.
4. **Create Release:** Click **Create Release Branch**, provide a branch name, and let the Orchestrator execute the plan.
5. **Add Notes:** Document any specific instructions or notes for the release, which are saved in your workspace state.

## Best Practices
- **Atomic Commits:** The Orchestrator works best when commits are focused and follow standard naming conventions (e.g., including `[#123]` in the message).
- **Target Comparison:** The "Commit Pool" automatically filters out commits that are already present in the target branch to avoid duplicates.
- **Review Before Execution:** Always check the AI's risk analysis report, especially for large releases with many cross-module dependencies.
