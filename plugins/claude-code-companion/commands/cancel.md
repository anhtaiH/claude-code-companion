---
description: Cancel a running Claude Code Companion job.
argument-hint: <job-id> [--cwd <path>]
---

# /claude:cancel

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "cancel"`
- `job_id` when supplied
- active workspace `cwd` unless the user supplied a different one

Report whether a running job was cancelled.
