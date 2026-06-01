# Security Policy

## Supported Versions

The `main` branch and the latest `1.x` release are supported.

## Reporting A Vulnerability

Do not open a public issue for a vulnerability that includes secrets, private
repository content, or exploit details.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for the repo.
2. If private reporting is not available, open a public issue with only a brief
   sanitized summary and ask for a private contact path.

## Scope

Security-sensitive areas include:

- Claude tool permissions
- dangerous CLI flags
- shell command construction
- state persistence
- log redaction
- outbound secret-like context blocking
- secret-like output handling
- prompt content boundaries

## Current Behavior

V1 asks Claude Code for review, diagnosis, planning, and research. It does not
ask Claude Code to edit files.

Before prompt construction it scans tracked diffs, untracked file bodies, task
prompts, focus text, and repository instruction context for secret-like content.
If the scan matches, the companion exits with code `2` and reports redacted
metadata. The explicit override is `--allow-sensitive-context` in the CLI or
`allow_sensitive_context` in MCP.

This scan is a defensive heuristic. It is not a replacement for a dedicated
secret scanner in CI or before public release.

Output redaction is separate. If Claude returns text that looks like a secret,
the companion redacts that stored result instead of discarding the whole job.
