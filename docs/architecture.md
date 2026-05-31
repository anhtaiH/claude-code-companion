# Architecture

## Components

```text
Codex
  |
  | skill-guided MCP tool call or MCP prompt
  v
scripts/mcp-server.mjs
  |
  | spawns companion CLI
  v
scripts/claude-companion.mjs
  |
  | builds prompts, git context, state, jobs
  v
claude -p --output-format json --tools ""
```

## Design Choices

The MCP server stays thin. It exposes the agent-native API, validates the MCP
shape, and delegates all real work to the companion CLI. This keeps debugging
simple because every MCP action has a direct CLI equivalent.

The primary MCP tool is `consult`. It maps review, adversarial review,
diagnosis, planning, and research modes onto the lower-level companion commands.
The lower-level tools remain available for compatibility and job management.

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
- MCP tool: `consult` is model-controlled and optimized for automatic agent use.
- MCP prompts: reusable user-controlled workflows that hosts can expose as slash
  commands or command-palette entries.

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
