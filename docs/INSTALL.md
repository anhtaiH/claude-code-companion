# Install

## Requirements

- Codex CLI with plugin and MCP support.
- Claude Code CLI `2.1.158` or newer, installed and signed in.
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

Reinstalling updates the files on disk, but an already-open Codex session can
keep the old MCP schema in memory. Always start a new session after install or
upgrade.

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
installing the current marketplace entry. After plugin install it replaces any
manifest-created MCP entry with one absolute `claude-code-companion` command
pointing at the installed plugin cache.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/anhtaiH/claude-code-companion/main/install.sh | bash -s -- --uninstall
```

Manual equivalent:

```bash
codex plugin remove claude@claude-code-companion
codex plugin remove claude-code-companion@claude-code-companion
codex plugin marketplace remove claude-code-companion
codex mcp remove claude-code-companion
codex mcp remove claude
```

Job state is not removed automatically. It lives under
`${XDG_STATE_HOME:-$HOME/.local/state}/claude-code-companion`.

## Authentication

The companion uses your local Claude Code CLI session. If setup reports that
Claude Code is not authenticated, run:

```bash
claude auth login
```

Then rerun `$claude setup` from a fresh Codex session.
