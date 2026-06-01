---
description: Ask Claude Code for a safe refactor plan.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [refactor goal]
---

# /claude:refactor-plan

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- active workspace `cwd`
- `kind: "refactor_plan"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort` and `timeout_ms`

Ask for small safe steps, verification points, and rollback-friendly ordering.
