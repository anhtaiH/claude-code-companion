---
description: Ask Claude Code for a skeptical review focused on hidden risk.
argument-hint: [--base <ref>] [--scope auto|working-tree|branch|repo] [--focus <text>] [--background] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [--strict-sensitive-context]
---

# /claude:adversarial-review

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- active workspace `cwd`
- `kind: "adversarial_review"`
- `target: "branch"` when `--base` or `--scope branch` is supplied
- `target: "repo"` when `--scope repo` is supplied
- `target: "working_tree"` otherwise
- optional `base`, `focus`, `background`, `model`, `effort` and `timeout_ms`

Focus on assumptions, rollback, data loss, auth, concurrency, and scope risk.
If the human only asked for review, present findings and stop. If this review
is part of a larger Codex implementation task, verify Claude's findings and
continue with the requested work.
