# Claude Code Companion

Claude Code Companion lets Codex delegate read-only work to Claude Code without
leaving the current Codex session.

This is not a nicer wrapper around `claude`. The product is cross-model,
cross-harness delegation: Codex stays in charge, Claude Code runs an independent
pass, and the result returns to Codex with a session id for follow-up.

## What You Get

- One public MCP tool: `claude_code`.
- One in-session workflow: delegate, check status, fetch result, continue.
- Read-only Claude Code passes for review, adversarial review, diagnosis,
  planning, and research.
- Local background job state keyed by workspace.
- Claude session ids for resumable handoff.
- A Codex skill that teaches the agent when and how to call the tool.

## Requirements

- Node.js 18.18 or newer.
- Codex CLI with MCP support.
- Claude Code CLI installed and authenticated.
- Git, for review targets that inspect diffs.

## Install

```bash
git clone https://github.com/anhtaih/claude-code-companion.git
cd claude-code-companion
npm run check
codex mcp add claude-code-companion -- node "$PWD/scripts/mcp-server.mjs"
```

Start a new Codex session after registering the MCP server.

## How To Use

Ask Codex naturally:

```text
Use Claude Code Companion to review the current diff with max_budget_usd 0.25.
```

Codex should call the single tool:

```json
{
  "action": "delegate",
  "kind": "review",
  "target": "working_tree",
  "max_budget_usd": 0.25
}
```

For longer work, Codex can use background mode:

```json
{
  "action": "delegate",
  "kind": "adversarial_review",
  "target": "branch",
  "base": "main",
  "focus": "auth, rollback, and data loss",
  "background": true,
  "max_budget_usd": 0.35
}
```

Then Codex stays in the same session and calls:

```json
{ "action": "status" }
```

```json
{ "action": "result", "job_id": "review-..." }
```

You should not need to run `claude`, `claude-companion.mjs`, or any other shell
wrapper during normal use.

## API

Everything goes through the `claude_code` MCP tool.

### Actions

- `setup`: check Node, Claude Code, Claude auth, and local state.
- `delegate`: start Claude Code work.
- `status`: list running and recent jobs.
- `result`: fetch a completed job result.
- `cancel`: stop a running background job.

### Delegation Kinds

- `review`: read-only code review of the current working tree or branch diff.
- `adversarial_review`: skeptical risk review focused on assumptions, rollback,
  data loss, auth, concurrency, and hidden coupling.
- `diagnose`: root-cause analysis.
- `plan`: implementation or verification planning.
- `research`: read-only repository investigation.

### Common Inputs

- `cwd`: workspace root. Defaults to the MCP server process working directory.
- `target`: `working_tree`, `branch`, or `none`.
- `base`: base ref for branch review, for example `main`.
- `prompt`: natural-language task for diagnosis, planning, or research.
- `focus`: optional focus area.
- `background`: return a job id immediately.
- `job_id`: job id for `status`, `result`, or `cancel`.
- `max_budget_usd`: optional spend guardrail.
- `timeout_ms`: optional timeout.
- `model` and `effort`: optional Claude Code runtime controls.

## Prompt Templates

Hosts that render MCP prompts can expose these as slash commands, command
palette entries, or prompt pickers. They all route through `claude_code`.

- `claude_review`
- `claude_adversarial_review`
- `claude_diagnose`
- `claude_plan`

## Architecture

```text
Codex session
  -> MCP tool: claude_code
  -> scripts/mcp-server.mjs
  -> internal transport: scripts/claude-companion.mjs
  -> claude -p --output-format json --tools ""
```

The companion script is internal transport. It keeps the MCP server debuggable,
but it is not the product API.

Job state is stored under:

```text
~/.local/state/claude-code-companion
```

The index is bounded to the latest 50 jobs per workspace.

## Security Model

V1 is read-only by default. Claude is invoked with no Claude tools:

```text
claude -p --output-format json --tools ""
```

The companion rejects write-capable or bypass-style options, including:

- `write`
- `edit`
- `permission-mode`
- `dangerously-skip-permissions`
- `allow-dangerously-skip-permissions`

The companion refuses to persist output that matches common secret-like patterns
such as private keys, AWS access keys, or `sk-` style tokens. This is a
guardrail, not a substitute for keeping secrets out of prompts and diffs.

For workplace projects, use this only when your organization allows sending
repository context to Anthropic Claude Code.

## Project Principles

- One public tool, not a menu of wrappers.
- Agent-native by default: stay inside Codex.
- Explicit controls for budget, timeout, target, and background work.
- Resumable handoff through job ids and Claude session ids.
- Claude output is advisory. Codex verifies before editing or claiming done.

## Development

```bash
npm run check
```

The tests use a fake `claude` binary, so they do not spend Claude credits.

## License

Apache-2.0. See [LICENSE](LICENSE).
