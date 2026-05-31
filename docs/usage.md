# Usage

## Direct CLI

The companion CLI is useful for debugging because it avoids any MCP layer:

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

After registering the MCP server:

```text
Use Claude Code Companion to run a read-only review of the working tree with max_budget_usd 0.25.
```

```text
Use Claude Code Companion for an adversarial review of this branch against main. Focus on auth and data deletion.
```

```text
Ask Claude Code Companion for a read-only diagnosis of this failing test. Return the Claude session ID.
```

## Workplace Use

Only use this on work projects if your company allows sending repository
context to Anthropic Claude Code. The plugin can restrict tools, but it cannot
decide whether a given repository is approved for a given provider.
