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

## 4. Verify From Codex

Open a new Codex session in any project and ask:

```text
Use Claude Code Companion to check setup for this workspace.
```

Codex should call the `claude_code` MCP tool with:

```json
{ "action": "setup" }
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
