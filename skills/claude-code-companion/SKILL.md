---
name: claude-code-companion
description: Use Claude Code from Codex for read-only second-model review, adversarial review, diagnosis, and planning.
---

# Claude Code Companion

Use this skill when Codex should ask Claude Code for model-diverse help while
keeping v1 read-only.

## When to use

- Run `review` before shipping when a second model family should inspect the
  current local diff.
- Run `adversarial_review` when the risk is about design choices, hidden
  assumptions, rollback, auth, data loss, concurrency, or scope creep.
- Run `task` for read-only diagnosis, planning, or research when Codex can pass
  enough context in the prompt.
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
2. Call `review` or `adversarial_review` with `background: true` for anything
   larger than a tiny diff.
3. Poll `status`.
4. Fetch `result` and present findings first, ordered by severity.
