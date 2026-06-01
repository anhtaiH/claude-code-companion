---
description: Ask Claude Code to review the current changes.
argument-hint: [--base <ref>] [--scope auto|working-tree|branch|repo] [--focus <text>] [--background] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [--strict-sensitive-context]
---

# /claude:review

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- active workspace `cwd`
- `kind: "review"`
- `target: "branch"` when `--base` or `--scope branch` is supplied
- `target: "repo"` when `--scope repo` is supplied
- `target: "working_tree"` otherwise
- optional `base`, `focus`, `background`, `model`, `effort` and `timeout_ms`

If the job runs in the background, use `/claude:status` and `/claude:result`.
If the human only asked for review, present findings and stop. If this review
is part of a larger Codex implementation task, verify Claude's findings and
continue with the requested work.
