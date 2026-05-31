# Agent-Native DX

Claude Code Companion is designed for an agent working inside Codex. The CLI is
still useful, but it is not the main product surface.

## Is This A Skill?

The plugin includes a Codex skill and an MCP server.

- The skill is the playbook. It tells Codex when Claude is useful, what safety
  boundaries apply, and how to present results.
- The MCP tools are the executable API. They are model-controlled, so an agent
  can discover them and call them when the current task warrants a Claude pass.
- The MCP prompts are user-controlled templates. They give slash-command or
  command-palette style entry points for common workflows.

That means the right mental model is not "run this script." The model is:

```text
Codex task
  -> skill guidance decides whether a Claude pass helps
  -> consult tool starts Claude Code read-only work
  -> status/result complete background jobs
  -> Codex verifies and acts
```

## Primary API

Use one tool first:

```text
consult
```

`consult` accepts a mode:

- `review`: normal second-model code review
- `adversarial_review`: skeptical risk review
- `diagnose`: root-cause analysis
- `plan`: implementation or verification planning
- `research`: read-only repository investigation

Low-level tools still exist for compatibility and job management:

- `setup`
- `review`
- `adversarial_review`
- `task`
- `status`
- `result`
- `cancel`

Agents should prefer `consult` unless they need a specific low-level behavior.

## Explicit User Entry Points

MCP prompts expose reusable workflows:

- `review_current_diff`
- `adversarial_review`
- `diagnose_with_claude`
- `plan_with_claude`

Hosts may render these as slash commands, command palette entries, buttons, or
prompt pickers. The protocol does not force one UI pattern.

## API Design Rules

1. One primary verb beats many similar verbs.
2. Mode is explicit.
3. Budget and timeout are first-class.
4. Read-only posture is visible in descriptions and tests.
5. Background work always returns a job id.
6. Completed work returns a Claude session id when available.
7. Tool descriptions explain purpose, when to use, limitations, and parameter
   effects.

## Why This Shape

Current agent tooling is converging on a layered model:

- Skills or instructions capture reusable procedures.
- MCP tools expose executable capabilities the model can call.
- MCP prompts provide explicit user-invoked workflows.
- Handoffs model specialist delegation as tool calls with typed arguments.

Claude Code Companion follows that stack. It keeps the user-visible command
surface small while giving the agent enough structured control to choose the
right Claude pass at the right time.

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
