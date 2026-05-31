---
description: Ask Claude Code to review dependency or migration risk.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [dependency or migration]
---

# /claude:dependency-review

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "dependency_review"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort` and `timeout_ms`

Ask for compatibility risks, migration notes, and verification gaps.
