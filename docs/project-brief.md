# Project Brief

## Goal

Claude Code Companion gives Codex a clean way to call Claude Code for
second-model help. The primary use cases are review, adversarial review,
diagnosis, and planning.

The project is intentionally generic. It should work in any repository where the
user is allowed to send local repository context to Claude Code.

## Positioning

Codex remains the primary coding agent. Claude acts as a companion reviewer,
diagnostician, or planner with a different model family and a resumable Claude
Code session.

The companion should feel boring in the right way:

- one public MCP tool
- explicit budgets
- local state
- no write permissions by default
- clear resume and handoff hints

## V1 Scope

- Codex plugin manifest.
- MCP server with one public tool: `claude_code`.
- `claude_code` actions for `setup`, `delegate`, `status`, `result`, and
  `cancel`.
- MCP prompt templates for common user-invoked workflows.
- Internal companion CLI for maintainers and debugging.
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
- Agents have one obvious public tool for Claude handoff.
- Normal use stays inside a single Codex session.
- The CLI works as an internal debug path before Codex MCP registration.
- The MCP tool is a thin adapter over the companion transport.
- Review outputs are structured and resumable.
- Safety posture is obvious from both docs and tests.
