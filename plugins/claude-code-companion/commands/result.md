---
description: Fetch a Claude Code Companion job result.
argument-hint: [job-id] [--cwd <path>]
---

# /claude:result

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "result"`
- optional `job_id`
- active workspace `cwd` unless the user supplied a different one

Present the stored result, Claude session id, and any actionable findings.
