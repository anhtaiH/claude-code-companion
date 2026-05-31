---
description: Ask Claude Code for an auth, privacy, and data exposure review.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [security focus]
---

# /claude:security-review

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "security_review"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort` and `timeout_ms`

Ask for auth mistakes, secrets, data exposure, unsafe defaults, and privacy risk.
