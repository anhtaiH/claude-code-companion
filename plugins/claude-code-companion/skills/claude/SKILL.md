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

Default delegations use `opus[1m]`, `max` effort, and dynamic workflows. Only
set `model` or `effort` when the user asks for a different tradeoff.

## When To Use

- Use `action: "setup"` when the user asks for setup, doctor, readiness, or
  auth checks.
- Use `kind: "review"` before shipping when another model should inspect the
  current diff.
- Use `kind: "adversarial_review"` when the risk is about assumptions,
  rollback, auth, data loss, concurrency, or scope creep.
- Use `kind: "diagnose"`, `kind: "plan"`, or `kind: "research"` for general
  investigation and planning.
- Use focused kinds such as `test_gap_review`, `spec_audit`,
  `pr_review_prep`, `release_risk`, `architecture_critique`,
  `refactor_plan`, `log_diagnose`, `dependency_review`, and
  `security_review` when the user asks for that specific pass.
- Use `status`, `result`, and `cancel` actions to manage background jobs.

## Boundaries

- Do not ask Claude Code to edit files.
- After presenting review findings, stop and ask the user which findings they
  want fixed before changing code.
- Treat Claude output as advisory. Codex remains responsible for verifying any
  fix before claiming completion.

## Typical Flow

1. Call `claude_code` with `action: "setup"` if readiness is unknown.
2. Call `claude_code` with `action: "delegate"` and the right `kind`.
3. Use `background: true` for larger work.
4. Poll with `action: "status"`.
5. Fetch with `action: "result"` and present findings by severity.

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
