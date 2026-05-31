---
description: Ask Claude Code to diagnose a failure or confusing behavior.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [problem]
---

# /claude:diagnose

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- `kind: "diagnose"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort` and `timeout_ms`

Summarize the likely cause and what Codex should verify next.
