# Changelog

## Unreleased

- Fix: schema reviews now work against current Claude Code CLIs (verified on
  2.1.170). Three drifts were repaired, found by running the real CLI:
  - Claude Code returns `--json-schema` output in a `structured_output` result
    field; the companion now prefers it over the (often empty) `result` text.
  - The review schema's standard `$schema`/`$id` meta keys silently disabled
    structured-output enforcement; they are stripped at the call boundary.
  - The base `--tools` restriction made schema runs die with a spurious
    `prompt_too_long`; it is no longer passed. Read-only posture is unchanged,
    enforced by `--allowedTools`, a hardened `--disallowedTools`
    (`Edit,Write,NotebookEdit`), and headless auto-deny of un-allowed tools.
- Fix: plain `review` delegations now include the user's focus and prompt text.
  The review prompt template had no focus slot, so review focus was silently
  dropped before reaching Claude (adversarial review was unaffected).
- Fix: the documented `--focus <text>` flag is honored by the bundled CLI for
  review, adversarial-review, and task commands instead of being swallowed.
- Fix: unknown CLI flags are rejected with a clear error instead of being
  silently consumed, where a typo could change run behavior without any signal.
  Free text still passes positionally; put it after `--` when it starts with a
  dash.
- Fix: MCP in-handler errors keep the request id so clients can correlate the
  failure instead of waiting on an orphaned call.
- Fix: MCP delegations refuse to run when no workspace root can be inferred,
  instead of silently targeting the plugin's own directory. Lifecycle actions
  keep the permissive fallback. Pass `cwd` on every call.
- Fix: marking a dead background worker failed now also rewrites its on-disk
  job file, so the raw request prompt no longer lingers there.
- Fix: a freshly queued job is no longer marked failed by a concurrent status
  call during the spawn window; its liveness reports `starting`.
- Fix: setup reports `ready: false` with a remediation step when the state
  directory is unwritable, instead of crashing.
- Fix: a nonzero Claude exit with empty stderr reports `exit <code>` as the
  answer instead of an empty string.
- Hardening: untracked-file context skips symlinks (no reads outside the repo)
  and caps per-file reads at 5 MiB.
- Hardening: prompt template substitution is single-pass, so template tokens
  quoted inside a diff stay literal instead of being re-substituted.
- Status: failed jobs preview their failure message instead of echoing the
  request as the answer; cancelled jobs no longer mislabel the request.
- MCP: initialize echoes a supported requested protocol version and reports the
  plugin manifest version in serverInfo.
- Validation: `npm run validate` now checks the prompt templates, review
  schema, skill, and runtime scripts ship with the plugin.

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
