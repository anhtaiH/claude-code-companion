# Claude Code Companion

Claude Code Companion is a Codex plugin and MCP server that lets Codex ask the
local Claude Code CLI for read-only review, diagnosis, and planning.

It is built for model diversity. Codex can keep driving the work while Claude
provides an independent second-model pass over the same repository, diff, or
problem statement.

## What It Does

- Runs read-only Claude Code reviews of a working tree or branch diff.
- Runs stricter adversarial reviews when you want a skeptical pass before
  shipping.
- Asks Claude for diagnosis, planning, or research without asking it to edit.
- Stores local job state by workspace so long-running jobs can be checked later.
- Returns Claude session IDs so you can resume directly with `claude -r`.
- Exposes a primary agent-facing MCP tool, `consult`, plus MCP prompt templates.
- Keeps the direct CLI as a debug and installation escape hatch.

## What It Does Not Do

- It does not grant Claude write access in v1.
- It does not pass `Edit`, `Write`, broad `Bash`, or dangerous permission flags.
- It does not replace your repo's tests, review rules, or release gates.
- It does not make provider-policy decisions for workplace code. Use it only
  where sending repository context to Claude is allowed.

## Requirements

- Node.js 18.18 or newer.
- Codex CLI with MCP support.
- Claude Code CLI installed and authenticated.
- Git, for review targets that inspect diffs.

Check Claude readiness:

```bash
claude --version
claude auth status
```

## Quick Start

Clone the repo:

```bash
git clone https://github.com/anhtaih/claude-code-companion.git
cd claude-code-companion
npm test
npm run validate
```

Register the MCP server with Codex:

```bash
codex mcp add claude-code-companion -- node "$PWD/scripts/mcp-server.mjs"
codex mcp list --json
```

Run a direct setup check if you want to verify outside Codex:

```bash
node scripts/claude-companion.mjs setup --cwd /path/to/your/repo
```

Ask for a read-only review through the debug CLI:

```bash
node scripts/claude-companion.mjs review \
  --cwd /path/to/your/repo \
  --scope working-tree \
  --max-budget-usd 0.25
```

Run a cheap live smoke test:

```bash
node scripts/claude-companion.mjs task \
  --cwd /path/to/your/repo \
  --max-budget-usd 0.05 \
  --timeout-ms 60000 \
  "Reply exactly: OK"
```

## Codex Usage

After adding the MCP server, start a new Codex session and ask:

```text
Use Claude Code Companion to run a read-only review of this working tree with max_budget_usd 0.25.
```

The agent-facing API is intentionally small. Most use should go through:

- `consult` with `mode: review`
- `consult` with `mode: adversarial_review`
- `consult` with `mode: diagnose`
- `consult` with `mode: plan`
- `consult` with `mode: research`

Useful MCP tools:

- `consult`: primary handoff to Claude Code for review, diagnosis, planning,
  and research.
- `setup`: check Node, Claude Code, auth, and local state.
- `review`: review a working tree or `base...HEAD` diff.
- `adversarial_review`: challenge the implementation and assumptions.
- `task`: ask for read-only diagnosis, planning, or research.
- `status`: list recent jobs for the current workspace.
- `result`: read a stored job result and Claude resume hint.
- `cancel`: stop a running background job.

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
