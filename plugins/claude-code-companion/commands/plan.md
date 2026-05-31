---
description: Ask Claude Code for an implementation or verification plan.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [goal]
---

# /claude:plan

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "plan"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort` and `timeout_ms`

Use Claude's plan as advisory input. Codex owns the final implementation.
