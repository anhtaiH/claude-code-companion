# Agent-Native DX

Claude Code Companion should feel like a delegation primitive inside Codex, not
a command-line utility.

## Product Stance

The user stays in one Codex session. Codex decides when a Claude pass helps,
calls one MCP tool, waits or polls if needed, then returns the result to the
same conversation.

```text
Codex task
  -> Codex calls claude_code
  -> Claude Code runs read-only work locally
  -> claude_code returns a result, job id, or session id
  -> Codex verifies and continues
```

## One Public API

The public MCP API is:

```text
claude_code
```

It has five actions:

- `setup`
- `delegate`
- `status`
- `result`
- `cancel`

Delegation uses `kind`:

- `review`
- `adversarial_review`
- `diagnose`
- `plan`
- `research`

This gives the agent one obvious tool while still preserving clear typed
intent.

## Why Not A CLI-First Wrapper

A shell wrapper does not solve the important problem. Anyone can run
`claude -p` directly. The useful product is the cross-model harness handoff:
Codex can ask Claude for a second-model pass, receive structured state, and keep
the user in one agent session.

The CLI in this repo exists because the MCP server needs an implementation
transport. It is for maintainers and debugging, not normal user workflow.

## Is This A Skill?

The skill is the instruction layer. It teaches Codex when to use Claude Code
Companion and what boundaries apply.

The MCP tool is the executable layer. Because MCP tools are model-controlled,
Codex can invoke `claude_code` when the current task warrants it.

MCP prompts are optional user-entry templates. A host may surface them as slash
commands or command-palette entries, but they still route through the one
`claude_code` tool.

## API Design Rules

1. One public tool.
2. One routing field: `action`.
3. One delegation field: `kind`.
4. Budget and timeout are explicit.
5. Background jobs return a job id.
6. Results return Claude session ids when available.
7. Claude remains read-only in v1.
8. Codex owns verification before acting on Claude output.

## Sources

- MCP server concepts describe tools as model-controlled, prompts as
  user-controlled templates, and resources as application-controlled context:
  <https://modelcontextprotocol.io/docs/learn/server-concepts>
- MCP tool docs describe tools as model-invoked capabilities with schema,
  security, consent, validation, and audit expectations:
  <https://modelcontextprotocol.io/specification/2024-11-05/server/tools>
- MCP prompt docs describe prompts as explicit user-controlled templates that
  clients may surface through slash commands or other UI patterns:
  <https://modelcontextprotocol.io/docs/concepts/prompts>
- OpenAI Agents SDK handoffs model specialist delegation as tools with typed
  input:
  <https://openai.github.io/openai-agents-python/handoffs/>
- Claude Code skills documentation frames skills as reusable instructions that
  can be invoked directly or used when relevant:
  <https://code.claude.com/docs/en/skills>
