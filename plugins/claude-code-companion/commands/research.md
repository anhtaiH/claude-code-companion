---
description: Ask Claude Code to research repository context.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--max-budget-usd <usd>] [--timeout-ms <ms>] [topic]
---

# /claude:research

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "research"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort`,
  `max_budget_usd`, and `timeout_ms`

Return the useful context and cite files or commands when Claude provides them.
