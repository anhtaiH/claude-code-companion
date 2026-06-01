# Changelog

## 1.0.0

- GA release of Claude Code Companion as a standalone public Codex plugin.
- Adds read-only Claude Code delegation for setup, review, adversarial review,
  diagnosis, planning, research, and focused advisory passes.
- Records secret-like outbound context warnings by default and supports strict
  blocking before prompt construction when requested.
- Upgrade note: pre-GA builds blocked heuristic sensitive-context matches by
  default. GA defaults to warn-and-continue; use strict sensitive-context mode
  to restore blocking behavior.
- Keeps output redaction separate from outbound warnings so malformed or
  secret-like Claude output is redacted and persisted for inspection.
- Hardens background job state with guarded JSON parsing, validated job IDs, and
  atomic result writes.
- Adds MCP parity for lifecycle actions, background jobs, optional budget guard,
  first-class repo review targets, and strict sensitive-context mode.
- Adds CI coverage for Node 20, 22, and 24.
