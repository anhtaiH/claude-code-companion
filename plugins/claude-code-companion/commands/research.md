---
description: Ask Claude Code to research repository context.
argument-hint: [--background] [--resume-last|--fresh] [--focus <text>] [--model <model>] [--effort low|medium|high|xhigh|max] [--timeout-ms <ms>] [topic]
---

# /claude:research

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "delegate"`
- active workspace `cwd`
- `kind: "research"`
- `prompt` from the remaining arguments
- optional `focus`, `background`, `resume_last`, `fresh`, `model`, `effort` and `timeout_ms`

Return the useful context and cite files or commands when Claude provides them.
