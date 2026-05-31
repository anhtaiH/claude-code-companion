# Contributing

Thanks for considering a contribution.

## Setup

```bash
git clone https://github.com/anhtaih/claude-code-companion.git
cd claude-code-companion
npm run check
```

The tests use a fake `claude` binary and should not spend Claude credits.

## Development Rules

- Keep v1 read-only.
- Do not add `Edit`, `Write`, broad `Bash`, or dangerous permission bypass
  support without a documented security redesign.
- Keep MCP tools thin. Put CLI, state, parsing, and rendering logic in the
  companion modules.
- Prefer structured JSON contracts for model output.
- Add or update fake-Claude tests for behavior changes.
- Do not commit real provider logs, secrets, or private repository content.

## Useful Commands

```bash
npm run validate
npm test
npm run check
```

For normal use, verify through Codex and the `claude_code` MCP tool. The
`scripts/claude-companion.mjs` runtime is internal transport for maintainers who
are debugging the MCP server itself.

## Pull Requests

Before opening a PR:

1. Run `npm run check`.
2. Update docs when behavior or install steps change.
3. Include the user-facing reason for the change.
4. Call out any security-model implications.

## Reporting Bugs

Open an issue with:

- operating system
- Node version
- Codex CLI version
- Claude Code version
- command or MCP tool used
- sanitized logs or output

Do not paste secrets, proprietary code, or private provider account details into
issues.
