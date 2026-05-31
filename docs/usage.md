# Usage

## Preferred Path: Codex Agent Tool Use

Register the MCP server once:

```bash
codex mcp add claude-code-companion -- node /path/to/claude-code-companion/scripts/mcp-server.mjs
```

Then start a new Codex session in any project and ask naturally:

```text
Use Claude Code Companion to review the current diff with max_budget_usd 0.25.
```

The agent should call the `consult` MCP tool. That is the primary API.

Typical modes:

```json
{ "mode": "review", "target": "working_tree", "max_budget_usd": 0.25 }
```

```json
{
  "mode": "adversarial_review",
  "target": "branch",
  "base": "main",
  "focus": "auth, rollback, and data loss",
  "max_budget_usd": 0.35
}
```

```json
{
  "mode": "diagnose",
  "prompt": "Diagnose why this test is flaky. Do not suggest edits.",
  "max_budget_usd": 0.2
}
```

## Direct CLI For Debugging

The companion CLI is useful when you need to debug the plugin itself because it
avoids the MCP layer:

```bash
node scripts/claude-companion.mjs setup --cwd /path/to/repo
```

## Review Current Working Tree

```bash
node scripts/claude-companion.mjs review \
  --cwd /path/to/repo \
  --scope working-tree \
  --max-budget-usd 0.25 \
  --timeout-ms 300000
```

## Review Branch Against A Base

```bash
node scripts/claude-companion.mjs review \
  --cwd /path/to/repo \
  --base main \
  --max-budget-usd 0.25
```

## Adversarial Review

Use this when you want Claude to challenge assumptions and focus on risk:

```bash
node scripts/claude-companion.mjs adversarial-review \
  --cwd /path/to/repo \
  --scope working-tree \
  --max-budget-usd 0.35 \
  "Focus on security, data loss, and hidden coupling."
```

## Read-Only Diagnosis Or Planning

```bash
node scripts/claude-companion.mjs task \
  --cwd /path/to/repo \
  --max-budget-usd 0.20 \
  "Diagnose why the failing test could be flaky. Do not suggest edits."
```

Resume the latest completed task for the same workspace:

```bash
node scripts/claude-companion.mjs task \
  --cwd /path/to/repo \
  --resume-last \
  "Given the prior diagnosis, propose a minimal verification plan."
```

## Background Jobs

Start a background review:

```bash
node scripts/claude-companion.mjs review \
  --cwd /path/to/repo \
  --scope working-tree \
  --background \
  --json
```

List jobs:

```bash
node scripts/claude-companion.mjs status --cwd /path/to/repo
```

Read a result:

```bash
node scripts/claude-companion.mjs result --cwd /path/to/repo <job-id>
```

Cancel a job:

```bash
node scripts/claude-companion.mjs cancel --cwd /path/to/repo <job-id>
```

## Codex MCP Prompts

The MCP server also exposes prompt templates for hosts that render MCP prompts
as slash commands, command palette entries, or prompt pickers:

- `review_current_diff`
- `adversarial_review`
- `diagnose_with_claude`
- `plan_with_claude`

## Workplace Use

Only use this on work projects if your company allows sending repository
context to Anthropic Claude Code. The plugin can restrict tools, but it cannot
decide whether a given repository is approved for a given provider.
