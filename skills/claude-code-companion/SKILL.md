---
name: claude-code-companion
description: Use Claude Code from Codex for read-only second-model review, adversarial review, diagnosis, and planning.
---

# Claude Code Companion

Use this skill when Codex should ask Claude Code for model-diverse help from
inside the current agent session while keeping v1 read-only.

The primary API is the `consult` MCP tool. The shell CLI exists for debugging
and installation checks, not for ordinary agent workflow.

## When to use

- Call `consult` with `mode: "review"` before shipping when a second model
  family should inspect the current local diff.
- Call `consult` with `mode: "adversarial_review"` when the risk is about
  design choices, hidden assumptions, rollback, auth, data loss, concurrency,
  or scope creep.
- Call `consult` with `mode: "diagnose"`, `mode: "plan"`, or
  `mode: "research"` when Codex can pass enough context in the prompt.
- Use `status`, `result`, and `cancel` to manage background jobs.

## Boundaries

- Do not ask Claude Code to edit files in v1.
- Do not request dangerous permission bypasses or broad shell access.
- After presenting review findings, stop and ask the user which findings they
  want fixed before changing code.
- Treat Claude output as advisory. Codex remains responsible for verifying any
  fix before claiming completion.

## Typical flow

1. Call `setup` if Claude Code readiness is unknown.
2. Call `consult` with the right `mode` and `background: true` for anything
   larger than a tiny diff.
3. Poll `status`.
4. Fetch `result` and present findings first, ordered by severity.

## Tool selection

- Prefer `consult` for new work.
- Use low-level `review`, `adversarial_review`, and `task` only when the user or
  host needs that exact command shape.
- Use MCP prompt templates when the user explicitly invokes a workflow through a
  slash-command or command-palette surface.
