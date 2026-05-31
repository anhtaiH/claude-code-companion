# Usage

Claude Code Companion is meant to be used from inside Codex. The normal user
experience is a single Codex chat session where Codex delegates to Claude Code
and returns with the result.

## Install Once

```bash
git clone https://github.com/anhtaih/claude-code-companion.git
cd claude-code-companion
npm run check
codex mcp add claude-code-companion -- node "$PWD/scripts/mcp-server.mjs"
```

Start a new Codex session after registering the MCP server.

## Primary API

There is one MCP tool:

```text
claude_code
```

Every operation goes through it.

### Setup

```json
{ "action": "setup" }
```

Use this when Codex needs to confirm Node, Claude Code, Claude auth, and local
job state are ready.

### Delegate Review

```json
{
  "action": "delegate",
  "kind": "review",
  "target": "working_tree",
  "max_budget_usd": 0.25
}
```

### Delegate Adversarial Review

```json
{
  "action": "delegate",
  "kind": "adversarial_review",
  "target": "branch",
  "base": "main",
  "focus": "auth, rollback, and data loss",
  "background": true,
  "max_budget_usd": 0.35
}
```

### Delegate Diagnosis

```json
{
  "action": "delegate",
  "kind": "diagnose",
  "prompt": "Diagnose why this test is flaky. Do not edit files.",
  "max_budget_usd": 0.2
}
```

### Delegate Planning

```json
{
  "action": "delegate",
  "kind": "plan",
  "prompt": "Plan the smallest safe implementation and verification path.",
  "max_budget_usd": 0.2
}
```

### Manage Background Work

```json
{ "action": "status" }
```

```json
{ "action": "result", "job_id": "review-..." }
```

```json
{ "action": "cancel", "job_id": "review-..." }
```

## Natural Codex Prompts

You should not have to type JSON in normal use. Ask Codex:

```text
Use Claude Code Companion to review the current diff with max_budget_usd 0.25.
```

```text
Use Claude Code Companion for an adversarial review against main. Focus on auth and data loss.
```

```text
Ask Claude Code Companion to diagnose why this test is flaky. Stay read-only.
```

Codex should call `claude_code`, wait or poll if needed, fetch the result, and
present the Claude findings back in the same session.

## Prompt Templates

The MCP server also exposes prompt templates for hosts that render MCP prompts
as slash commands, command palette entries, or prompt pickers:

- `claude_review`
- `claude_adversarial_review`
- `claude_diagnose`
- `claude_plan`

Each template still routes through the same `claude_code` tool.

## Internal Runtime

The repository contains `scripts/claude-companion.mjs` because the MCP server
needs a local transport around the Claude Code CLI. Treat it like
implementation machinery. It is useful for maintainers debugging the plugin, but
it is not the product API and should not be the normal workflow.

## Workplace Use

Only use this on work projects if your company allows sending repository
context to Anthropic Claude Code. The plugin restricts Claude tool access, but it
cannot approve a provider for a repository.
