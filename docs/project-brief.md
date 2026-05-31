# Project Brief

## Goal

Claude Code Companion gives Codex a clean way to call Claude Code for
second-model help. The primary use cases are review, adversarial review,
diagnosis, and planning.

The project is intentionally generic. It should work in any repository where the
user is allowed to send local repository context to Claude Code.

## Positioning

Codex remains the primary coding agent. Claude acts as a companion reviewer or
planner with a different model family and a resumable Claude Code session.

The companion should feel boring in the right way:

- predictable commands
- explicit budgets
- local state
- no write permissions by default
- clear resume and handoff hints

## V1 Scope

- Codex plugin manifest.
- MCP server with primary `consult` handoff plus `setup`, `review`,
  `adversarial_review`, `task`, `status`, `result`, and `cancel`.
- MCP prompt templates for common user-invoked workflows.
- Companion CLI for direct debugging.
- Local job board under `~/.local/state/claude-code-companion`.
- Read-only Claude calls through `claude -p --output-format json --tools ""`.
- Fake-Claude test harness.
- Public documentation for installation, usage, security, and contribution.

## Non-Goals

- Claude edit/write access.
- Broad shell permissions.
- Live agent-to-agent chat.
- Provider-policy bypasses for workplace or private code.
- Repo-specific hard-coding for one pilot project.

## Success Criteria

- A user can install the repo once and use it from multiple projects.
- Agents have one obvious primary tool for Claude handoff.
- The CLI works as a debug path before Codex MCP registration.
- MCP tools are thin wrappers over the companion CLI.
- Review outputs are structured and resumable.
- Safety posture is obvious from both docs and tests.
