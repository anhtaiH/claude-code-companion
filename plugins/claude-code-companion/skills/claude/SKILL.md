---
name: claude
description: Use Claude Code from Codex as a side helper for setup, review, diagnosis, planning, and research.
---

# Claude Code Companion

Use this skill when Codex should ask Claude Code for help from inside the
current agent session. In the Codex app, users invoke this as `$claude`.

Prefer the `claude_code` MCP tool when it is available. If Codex has loaded
this skill but has not exposed the MCP tool, run the bundled companion script
yourself. Do not ask the user to leave Codex or run `claude` directly.

Default delegations use `opus[1m]`, `max` effort, Ultracode dynamic workflows,
and read-only specialist subagents. Only set `model` or `effort` when the user
asks for a different tradeoff.

The primary caller is Codex. Choose sensible tool arguments yourself instead
of making the human learn the runtime:

- Pass the absolute active workspace root as `cwd` on every MCP call.
  Lifecycle calls can recover by job id if `cwd` drifts, but stable `cwd`
  keeps status/result scoped and predictable.
- Current uncommitted work: `target: "working_tree"`.
- Branch review against a base ref: `target: "branch"` plus `base`.
- Full repository review: `target: "repo"`.
- Diagnosis, planning, and research do not need `target`; omit it.
- Leave `strict_sensitive_context` unset by default. The companion records a
  warning for heuristic secret-like context and continues. Use strict mode only
  when the user explicitly asks for blocking behavior.

## When To Use

- Use `action: "setup"` when the user asks for setup, doctor, readiness, or
  auth checks.
- Use `kind: "review"` before shipping when another model should inspect the
  current diff.
- Use `kind: "adversarial_review"` when the risk is about assumptions,
  rollback, auth, data loss, concurrency, or scope creep.
- Use `kind: "diagnose"`, `kind: "plan"`, or `kind: "research"` for general
  investigation and planning.
- For a specialist angle (security, tests, release risk, architecture, logs,
  dependencies, spec, or PR prep), keep the same five kinds and pass the
  `focus` argument, for example `kind: "review"` with `focus: "auth, secrets"`
  or `kind: "research"` with `focus: "dependency upgrade risk"`. The read-only
  specialist subagents run regardless of focus.
- Use `status`, `result`, and `cancel` actions to manage background jobs.

## Reading The Result

Every result is JSON with a small, stable envelope:

- `ok` is `false` when the run failed or is degraded (timeout, parse failure,
  diff error, or a failed background job). Check `ok` before trusting `verdict`
  or `answer`.
- `degraded: true` marks a result the model did not fully produce.
- `kind` identifies the payload (`review`, `task`, `setup`, `status`,
  `result`, `cancel`, `queued`).
- `answer` is the single best string to relay; reviews also carry structured
  `review.verdict` and `review.findings`.

A failed lifecycle lookup (unknown `job_id`) returns `ok: false` with an
`error` and a nonzero exit, so a missing job is never a silent empty success.

For substantive reviews, diagnosis, research, and planning, start the job in
the background unless the request is tiny. Poll status, fetch the result, then
present Claude's synthesized findings to the user.

## Boundaries

- Do not ask Claude Code to edit files.
- If the human only asked for a review, present findings and stop.
- If the human asked Codex to implement, fix, or get to done while using Claude
  as a helper, treat Claude output as advisory input and keep working after you
  verify it yourself.
- Treat Claude output as advisory. Codex remains responsible for verifying any
  fix before claiming completion.

## Typical Flow

1. Call `claude_code` with `action: "setup"` if readiness is unknown.
2. Call `claude_code` with `action: "delegate"` and the right `kind`.
3. Use `background: true` for larger work.
4. Poll with `action: "status"`.
5. Fetch with `action: "result"` and present findings by severity.
6. Include companion health when it is present: job id, Claude session id,
   model, target label, parser status, raw-output preservation, warnings, and
   whether transcript recovery was needed.

If `claude_code` is unavailable, resolve the companion script at
`../../scripts/claude-companion.mjs` relative to this `SKILL.md` file and run
the equivalent command:

- Setup: `node <script> setup --cwd <workspace> --json`.
- Review: `node <script> review --cwd <workspace> --json [focus]`.
- Adversarial review:
  `node <script> adversarial-review --cwd <workspace> --json [focus]`.
- Task:
  `node <script> task --cwd <workspace> --kind <kind> --json [prompt]`.
- Lifecycle:
  `node <script> status|result|cancel --cwd <workspace> --json [job-id]`.

## User Phrases

Map common `$claude` requests directly:

- `$claude setup` -> `action: "setup"`.
- `$claude review current changes` -> `action: "delegate"`, `kind: "review"`.
- `$claude adversarial review` -> `kind: "adversarial_review"`.
- `$claude diagnose ...` -> `kind: "diagnose"`.
- `$claude plan ...` -> `kind: "plan"`.
- `$claude status`, `$claude result`, `$claude cancel` -> matching lifecycle
  actions.
