---
description: Ask Claude Code to compare implementation against a spec or task.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--max-budget-usd <usd>] [--timeout-ms <ms>] [spec or task]
---

# /claude:spec-audit

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "spec_audit"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort`,
  `max_budget_usd`, and `timeout_ms`

Ask for mismatches between requested behavior, implementation, and tests.
