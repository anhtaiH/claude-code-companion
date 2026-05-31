---
description: Ask Claude Code to find missing or weak tests.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [change or area]
---

# /claude:test-gap-review

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "test_gap_review"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort` and `timeout_ms`

Ask for concrete missing cases and the smallest useful verification path.
