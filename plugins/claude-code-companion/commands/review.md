---
description: Ask Claude Code to review the current changes.
argument-hint: [--base <ref>] [--scope auto|working-tree|branch] [--focus <text>] [--background] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>]
---

# /claude:review

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "review"`
- `target: "branch"` when `--base` or `--scope branch` is supplied
- `target: "working_tree"` otherwise
- optional `base`, `focus`, `background`, `model`, `effort` and `timeout_ms`

If the job runs in the background, use `/claude:status` and `/claude:result`.
Present findings before changing files.
