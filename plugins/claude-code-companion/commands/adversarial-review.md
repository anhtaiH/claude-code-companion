---
description: Ask Claude Code for a skeptical review focused on hidden risk.
argument-hint: [--base <ref>] [--scope auto|working-tree|branch] [--focus <text>] [--background] [--model <model>] [--effort low|medium|high|xhigh|max] [--max-budget-usd <usd>] [--timeout-ms <ms>]
---

# /claude:adversarial-review

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "adversarial_review"`
- `target: "branch"` when `--base` or `--scope branch` is supplied
- `target: "working_tree"` otherwise
- optional `base`, `focus`, `background`, `model`, `effort`,
  `max_budget_usd`, and `timeout_ms`

Focus on assumptions, rollback, data loss, auth, concurrency, and scope risk.
Present findings before changing files.
