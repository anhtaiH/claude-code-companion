# Install

## Requirements

- Codex CLI with plugin and MCP support.
- Claude Code CLI installed and signed in.
- Node.js 20 or newer.
- Git for diff-based review context.

## One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/anhtaiH/claude-code-companion/main/install.sh | bash
```

Start a new Codex session after installing, then run:

```text
$claude setup
```

## Manual Install

```bash
codex plugin marketplace add anhtaiH/claude-code-companion
codex plugin add claude@claude-code-companion
```

If you need to register the MCP server manually, use the installed plugin root
reported by `codex plugin add`:

```bash
codex mcp add claude-code-companion -- node "<installed-plugin-root>/scripts/mcp-server.mjs"
```

## Upgrade

Rerun the installer. It removes the previous plugin and MCP registration before
installing the current marketplace entry.

## Authentication

The companion uses your local Claude Code CLI session. If setup reports that
Claude Code is not authenticated, run:

```bash
claude auth login
```

Then rerun `$claude setup` from a fresh Codex session.
