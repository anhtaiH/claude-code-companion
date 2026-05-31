# Security Model

## Default Posture

V1 is read-only by default.

Claude is invoked with:

```text
claude -p --output-format json --tools ""
```

The companion rejects write-capable or bypass-style options, including:

- `write`
- `edit`
- `permission-mode`
- `dangerously-skip-permissions`
- `allow-dangerously-skip-permissions`

## What Claude Receives

For review jobs, the companion collects:

- deterministic git diff context
- untracked file list and capped content snippets
- repository instruction summaries from common files such as `AGENTS.md`,
  `CLAUDE.md`, and `README.md`
- review prompt and JSON output schema

For task jobs, Claude receives the prompt plus a compact repository context.

## What Is Stored Locally

Job state is stored under:

```text
~/.local/state/claude-code-companion
```

Each workspace gets a hashed state directory. Jobs record:

- job id
- workspace root
- kind and status
- process id for background workers
- Claude session id, when available
- result and log file paths
- timestamps

The index is bounded to the latest 50 jobs per workspace.

## Secret Handling

The companion refuses to persist output that matches common secret-like
patterns, such as private keys, AWS access keys, or `sk-` style tokens. This is
a guardrail, not a substitute for keeping secrets out of prompts and diffs.

Do not paste secrets into Claude prompts. Do not publish logs containing secrets.

## Limits

This project controls how the local companion invokes Claude Code. It does not
control Anthropic account policy, provider retention settings, workplace
approval, or the content of a repository diff.

For workplace projects, confirm that Claude Code is approved before use.
