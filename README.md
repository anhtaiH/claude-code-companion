# Claude Code Companion

Claude Code Companion lets Codex delegate read-only work to Claude Code without
leaving the current Codex session.

The product is cross-model, cross-harness delegation. Codex stays in charge,
Claude Code runs an independent pass, and the result returns to Codex with a job
id and Claude session id for follow-up.

## Install

No clone required:

```bash
curl -fsSL https://raw.githubusercontent.com/anhtaiH/claude-code-companion/main/install.sh | bash
```

Then start a new Codex session and ask:

```text
Use Claude Code Companion to check setup.
```

The installer uses Codex's native plugin system:

```bash
codex plugin marketplace add anhtaiH/claude-code-companion
codex plugin add claude-code-companion@claude-code-companion
```

Rerun the installer to update.

## Requirements

- Node.js 18.18 or newer.
- Codex CLI with plugin and MCP support.
- Claude Code CLI installed and authenticated.
- Git for diff-based reviews.

## How You Use It

Ask Codex naturally from the project you are working in:

```text
Use Claude Code Companion to review the current diff with max_budget_usd 0.25.
```

Codex should call the single MCP tool:

```json
{
  "action": "delegate",
  "kind": "review",
  "target": "working_tree",
  "max_budget_usd": 0.25
}
```

For longer work, Codex can start Claude in the background:

```json
{
  "action": "delegate",
  "kind": "adversarial_review",
  "target": "branch",
  "base": "main",
  "focus": "auth, rollback, and data loss",
  "background": true,
  "max_budget_usd": 0.35
}
```

Codex can then stay in the same session and call:

```json
{ "action": "status" }
```

```json
{ "action": "result", "job_id": "review-..." }
```

You should not need to run `claude` or any project-specific wrapper during
normal use.

## API

Everything goes through one public MCP tool: `claude_code`.

Actions:

- `setup`: check Node, Claude Code, Claude auth, and local state.
- `delegate`: start Claude Code work.
- `status`: list running and recent jobs.
- `result`: fetch a completed job result.
- `cancel`: stop a running background job.

Delegation kinds:

- `review`: read-only code review of the working tree or branch diff.
- `adversarial_review`: skeptical review for hidden risk and bad assumptions.
- `diagnose`: root-cause analysis.
- `plan`: implementation or verification planning.
- `research`: read-only repository investigation.

Common inputs:

- `cwd`: workspace root. Defaults to the MCP server process working directory.
- `target`: `working_tree`, `branch`, or `none`.
- `base`: base ref for branch review, for example `main`.
- `prompt`: natural-language task for diagnosis, planning, or research.
- `focus`: optional focus area.
- `background`: return a job id immediately.
- `job_id`: job id for `status`, `result`, or `cancel`.
- `max_budget_usd`: optional spend guardrail.
- `timeout_ms`: optional timeout.
- `model` and `effort`: optional Claude Code runtime controls.

MCP prompt templates are also available for hosts that expose them:
`claude_review`, `claude_adversarial_review`, `claude_diagnose`, and
`claude_plan`.

## How It Works

```text
Codex session
  -> MCP tool: claude_code
  -> plugins/claude-code-companion/scripts/mcp-server.mjs
  -> plugins/claude-code-companion/scripts/claude-companion.mjs
  -> claude -p --output-format json --tools ""
```

Job state is stored under:

```text
~/.local/state/claude-code-companion
```

The index is bounded to the latest 50 jobs per workspace.

## Security Model

V1 is read-only by default. Claude is invoked with no Claude tools:

```text
claude -p --output-format json --tools ""
```

The companion rejects write-capable or bypass-style options, including `write`,
`edit`, `permission-mode`, `dangerously-skip-permissions`, and
`allow-dangerously-skip-permissions`.

The companion refuses to persist output that matches common secret-like patterns
such as private keys, AWS access keys, or `sk-` style tokens. This is a
guardrail, not a substitute for keeping secrets out of prompts and diffs.

For workplace projects, use this only when your organization allows sending
repository context to Anthropic Claude Code.

## Development

```bash
git clone https://github.com/anhtaiH/claude-code-companion.git
cd claude-code-companion
npm run check
```

The tests use a fake `claude` binary, so they do not spend Claude credits.

## License

Apache-2.0. See [LICENSE](LICENSE).
