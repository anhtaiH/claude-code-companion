---
description: Ask Claude Code to diagnose logs, stack traces, or CI output.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--max-budget-usd <usd>] [--timeout-ms <ms>] [logs or failing command]
---

# /claude:log-diagnose

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "log_diagnose"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort`,
  `max_budget_usd`, and `timeout_ms`

Ask for the failure category, likely cause, and narrowest next check.
