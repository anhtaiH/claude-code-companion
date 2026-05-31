---
name: claude-code-companion
description: Use Claude Code from Codex as a side helper for review, diagnosis, planning, and research.
---

# Claude Code Companion

Use this skill when Codex should ask Claude Code for help from inside the
current agent session.

Use the `claude_code` MCP tool. Slash commands under `/claude:*` are command
shortcuts into the same tool. Do not call shell commands directly for normal
workflow.

Default delegations use `opus[1m]`, `max` effort, and dynamic workflows. Only
set `model` or `effort` when the user asks for a different tradeoff.

## When To Use

- Use `kind: "review"` before shipping when another model should inspect the
  current diff.
- Use `kind: "adversarial_review"` when the risk is about assumptions,
  rollback, auth, data loss, concurrency, or scope creep.
- Use `kind: "diagnose"`, `kind: "plan"`, or `kind: "research"` for general
  investigation and planning.
- Use focused kinds such as `test_gap_review`, `spec_audit`,
  `pr_review_prep`, `release_risk`, `architecture_critique`,
  `refactor_plan`, `log_diagnose`, `dependency_review`, and
  `security_review` when the user asks for that specific pass.
- Use `status`, `result`, and `cancel` actions to manage background jobs.

## Boundaries

- Do not ask Claude Code to edit files.
- After presenting review findings, stop and ask the user which findings they
  want fixed before changing code.
- Treat Claude output as advisory. Codex remains responsible for verifying any
  fix before claiming completion.

## Typical Flow

1. Call `claude_code` with `action: "setup"` if readiness is unknown.
2. Call `claude_code` with `action: "delegate"` and the right `kind`.
3. Use `background: true` for larger work.
4. Poll with `action: "status"`.
5. Fetch with `action: "result"` and present findings by severity.
