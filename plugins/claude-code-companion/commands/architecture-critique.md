---
description: Ask Claude Code to challenge an architecture or design direction.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [design question]
---

# /claude:architecture-critique

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "architecture_critique"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort` and `timeout_ms`

Ask for simpler options, hidden coupling, and boundary problems.
