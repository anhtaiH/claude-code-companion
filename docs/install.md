# Install

## 1. Install Prerequisites

Install:

- Node.js 18.18 or newer
- Codex CLI
- Claude Code CLI

Authenticate Claude Code:

```bash
claude auth status
```

If Claude is not logged in, run the login command recommended by Claude Code.

## 2. Clone This Repo

```bash
git clone https://github.com/anhtaih/claude-code-companion.git
cd claude-code-companion
npm run check
```

## 3. Register With Codex MCP

From the cloned repo:

```bash
codex mcp add claude-code-companion -- node "$PWD/scripts/mcp-server.mjs"
codex mcp list --json
```

Start a new Codex thread after registering the MCP server so the tools are
loaded into the session.

## 4. Verify From Any Project

Replace `/path/to/project` with the repository you want Claude to inspect:

```bash
node /path/to/claude-code-companion/scripts/claude-companion.mjs setup \
  --cwd /path/to/project
```

Cheap live smoke:

```bash
node /path/to/claude-code-companion/scripts/claude-companion.mjs task \
  --cwd /path/to/project \
  --max-budget-usd 0.05 \
  --timeout-ms 60000 \
  "Reply exactly: OK"
```

## Uninstall

Remove the Codex MCP registration:

```bash
codex mcp remove claude-code-companion
```

Local job state is stored under:

```text
~/.local/state/claude-code-companion
```
