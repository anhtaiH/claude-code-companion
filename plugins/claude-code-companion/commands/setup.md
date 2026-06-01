---
description: Check whether Claude Code Companion is ready in this workspace.
argument-hint: [--cwd <path>]
---

# /claude:setup

Arguments: $ARGUMENTS

Call `claude_code` with:

- `action: "setup"`
- active workspace `cwd` unless the user supplied a different one

Report whether Claude Code is installed and signed in. If setup is not ready,
show the next step and stop.
