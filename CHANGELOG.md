# Changelog

## 1.0.0

- GA release of Claude Code Companion as a standalone public Codex plugin.
- Adds read-only Claude Code delegation for setup, review, adversarial review,
  diagnosis, planning, research, and focused advisory passes.
- Blocks secret-like outbound context by default before prompt construction.
- Keeps output redaction separate from outbound blocking so malformed or
  secret-like Claude output is redacted and persisted for inspection.
- Hardens background job state with guarded JSON parsing, validated job IDs, and
  atomic result writes.
- Adds MCP parity for lifecycle actions, background jobs, optional budget guard,
  and explicit sensitive-context override.
- Adds CI coverage for Node 20, 22, and 24.
