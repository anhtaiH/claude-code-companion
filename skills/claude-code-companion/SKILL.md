---
name: claude-code-companion
description: Use Claude Code from Codex for read-only second-model review, adversarial review, diagnosis, and planning.
---

# Claude Code Companion

Use this skill when Codex should ask Claude Code for model-diverse help from
inside the current agent session while keeping v1 read-only.

The only public API is the `claude_code` MCP tool. The shell CLI is internal
transport for the plugin and should not be used in ordinary agent workflow.

## When to use

- Call `claude_code` with `action: "delegate"` and `kind: "review"` before
  shipping when a second model family should inspect the current local diff.
- Call `claude_code` with `kind: "adversarial_review"` when the risk is about
  design choices, hidden assumptions, rollback, auth, data loss, concurrency,
  or scope creep.
- Call `claude_code` with `kind: "diagnose"`, `kind: "plan"`, or
  `kind: "research"` when Codex can pass enough context in the prompt.
- Use the same `claude_code` tool with `action: "status"`, `action: "result"`,
  and `action: "cancel"` to manage background jobs.

## Boundaries

- Do not ask Claude Code to edit files in v1.
- Do not request dangerous permission bypasses or broad shell access.
- After presenting review findings, stop and ask the user which findings they
  want fixed before changing code.
- Treat Claude output as advisory. Codex remains responsible for verifying any
  fix before claiming completion.

## Typical flow

1. Call `claude_code` with `action: "setup"` if readiness is unknown.
2. Call `claude_code` with `action: "delegate"`, the right `kind`, and
   `background: true` for anything larger than a tiny diff.
3. Poll with `claude_code` and `action: "status"`.
4. Fetch with `claude_code` and `action: "result"`, then present findings
   first, ordered by severity.

## Tool selection

- Always use `claude_code` for Claude Code Companion work.
- Do not call shell commands directly for normal use.
- Use MCP prompt templates when the user explicitly invokes a workflow through a
  slash-command or command-palette surface.
