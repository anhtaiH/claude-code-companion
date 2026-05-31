# Claude Code Companion

Claude Code Companion lets Codex delegate read-only work to Claude Code without
leaving the current Codex session.

The value is not a nicer wrapper around `claude`. The value is cross-model,
cross-harness delegation: Codex stays in charge of the task, Claude Code runs an
independent pass, then the result returns to Codex with a session id for
follow-up.

## What You Get

- One MCP tool: `claude_code`.
- One in-session delegation shape:
  - `action: "setup"`
  - `action: "delegate"`
  - `action: "status"`
  - `action: "result"`
  - `action: "cancel"`
- Delegation kinds:
  - `review`
  - `adversarial_review`
  - `diagnose`
  - `plan`
  - `research`
- Local job state for background work.
- Claude session ids so the work can be resumed or handed off.
- A Codex skill that teaches the agent when to call the tool.

## What It Does Not Do

- It does not make the user leave Codex for normal use.
- It does not expose a public menu of shell wrappers as the product API.
- It does not grant Claude write access in v1.
- It does not pass `Edit`, `Write`, broad `Bash`, or dangerous permission flags.
- It does not decide whether your workplace allows sending code to Claude.

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

## Use It From Codex

Ask naturally:

```text
Use Claude Code Companion to review the current diff with max_budget_usd 0.25.
```

Codex should call the single MCP tool:

```json
{
  "action": "delegate",
  "kind": "review",
  "target": "working_tree",
  "max_budget_usd": 0.25
}
```

For a larger job, Codex can use background mode and stay in the same session:

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

Then:

```json
{ "action": "status" }
```

```json
{ "action": "result", "job_id": "review-..." }
```

The user never needs to run `claude` or `claude-companion.mjs` directly during a
normal coding session.

## Documentation

- [Install](docs/install.md)
- [Usage](docs/usage.md)
- [Agent-native DX](docs/agent-native-dx.md)
- [Security model](docs/security-model.md)
- [Architecture](docs/architecture.md)
- [Project brief](docs/project-brief.md)
- [Public repo quality baseline](docs/repo-quality.md)
- [Roadmap](docs/roadmap.md)

## Development

```bash
npm run check
```

The tests use a fake `claude` binary, so they do not spend Claude credits.

## License

Apache-2.0. See [LICENSE](LICENSE).
