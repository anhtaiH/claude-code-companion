---
description: Ask Claude Code what PR reviewers will likely question.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--max-budget-usd <usd>] [--timeout-ms <ms>] [PR or change]
---

# /claude:pr-review-prep

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "pr_review_prep"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort`,
  `max_budget_usd`, and `timeout_ms`

Ask for reviewer concerns, unclear tradeoffs, and validation gaps.
