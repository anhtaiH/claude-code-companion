# Architecture

## Components

```text
Codex session
  |
  | MCP tool: claude_code
  v
scripts/mcp-server.mjs
  |
  | internal transport
  v
scripts/claude-companion.mjs
  |
  | local Claude Code invocation, git context, job state
  v
claude -p --output-format json --tools ""
```

## Design Choices

The MCP server exposes one public tool: `claude_code`. That tool owns setup,
delegation, status, result, and cancellation through an `action` field.

The companion CLI remains an internal transport around Claude Code. It exists so
the MCP server has a debuggable implementation boundary, not because users
should leave Codex to run shell commands.

The companion owns:

- setup checks
- git target resolution
- prompt rendering
- Claude invocation
- result parsing
- local job state
- background process lifecycle
- cancellation
- rendering JSON or text output

## Agent-Native Surface

The plugin ships three layers:

- Skill: tells Codex when to consult Claude and how to handle advisory output.
- MCP tool: `claude_code` is model-controlled and optimized for automatic agent
  use.
- MCP prompts: reusable user-controlled workflows that hosts can expose as slash
  commands or command-palette entries. They still route through `claude_code`.

## Job State

State is local and workspace-scoped. The companion resolves the workspace root,
hashes it, and writes job metadata under:

```text
~/.local/state/claude-code-companion/<workspace-name>-<hash>
```

If `CODEX_PLUGIN_DATA` or `CLAUDE_CODE_COMPANION_STATE_DIR` is set, the
companion uses that location instead.

## Review Target Resolution

Review supports three target modes:

- `working-tree`: current tracked and untracked changes
- `branch`: `base...HEAD`
- `auto`: branch diff when a base is provided, otherwise working tree

The companion computes this target before calling Claude so prompts are stable
and auditable.

## Output Contract

Review prompts ask Claude to return strict JSON matching
`schemas/review-output.schema.json`. If Claude returns malformed output, the
companion converts it into a `needs-attention` result rather than pretending the
review passed.
