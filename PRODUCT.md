# Product

## Register

product

## Users

Claude Code Companion serves developers who work inside Codex and want an
independent Claude Code pass without leaving the agent session. The primary user
is the active coding agent, which needs a clear, model-controlled tool contract.
The secondary user is the developer who installs the plugin, sets budget and
permission expectations, and reads the resulting review or handoff.

## Product Purpose

The product lets Codex consult Claude Code for read-only review, adversarial
review, diagnosis, planning, and research. Success means an agent can discover
one obvious handoff surface, invoke it safely, receive structured results, and
continue the main task with a Claude session id available for follow-up.

## Brand Personality

Precise, calm, and operator-grade. The voice should be direct about safety
boundaries, cost, and handoff state. It should feel like infrastructure for
serious coding sessions, not a novelty wrapper around two chat tools.

## Anti-references

- CLI-first workflows presented as the main user experience.
- Slash-command clones that hide an unclear tool contract.
- Broad permission modes, write-capable defaults, or provider-policy ambiguity.
- Long command catalogs that make the agent guess which tool owns the workflow.
- Marketing copy that claims autonomy without explaining control, state, and
  verification.

## Design Principles

- Agent first, CLI second: the primary API is the MCP surface an agent can call
  inside Codex; shell commands exist for debugging and installation.
- One obvious handoff: the default path should be `consult`, with specialist
  modes rather than a menu of nearly identical tools.
- Explicit control: budget, timeout, target, and read-only posture should be
  visible in the contract.
- Resumable work: every useful Claude run should return a session id, job id, or
  next action.
- Advisory by default: Claude output informs Codex, but Codex verifies before
  editing or claiming completion.

## Accessibility & Inclusion

Documentation should use plain language, copyable commands, and predictable
sections. Terminal and MCP output should be readable as text, avoid decorative
formatting, and expose status fields that can be consumed by assistive tools or
automation.
