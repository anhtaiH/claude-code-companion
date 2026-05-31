---
description: Show Claude Code Companion job status.
argument-hint: [job-id] [--all] [--cwd <path>]
---

# /claude:status

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "status"`
- optional `job_id`
- optional `all`
- optional `cwd`

Show active jobs first and include the job id needed for `/claude:result`.
