# Troubleshooting

## `$claude setup` Says Claude Code Is Missing

Install Claude Code first, then rerun the installer. The companion shells out to
the local `claude` binary and does not bundle Claude Code.

## `$claude setup` Says Claude Code Is Not Authenticated

Run:

```bash
claude auth login
```

Start a fresh Codex session and run `$claude setup` again.

## `$claude setup` Says Claude Code Is Unsupported

Update Claude Code to `2.1.158` or newer. The companion uses Claude Code flags
for Opus 1M, max effort, JSON schema output, and read-only subagents that were
validated against that version line.

## Review Reports Sensitive-Context Warnings

Sensitive-context warnings mean the companion found heuristic secret-like
outbound context. By default this does not block Claude. It scans tracked diffs,
untracked file bodies, task prompts, focus text, and repo instruction context.

If your team wants this to block before Claude is called, use CLI
`--strict-sensitive-context` or MCP `strict_sensitive_context: true`.

## Review Blocks With Exit Code 2

Exit code `2` means strict sensitive-context mode found secret-like outbound
context before it called Claude. Remove the secret-like content from the diff or
prompt, or rerun without strict mode.

## Result Contains Redactions

Redactions in a stored result mean Claude returned text that looked like a
token, password, private key, or similar secret. The companion redacts that
output and keeps the result so `status` and `result` still work.

## Job Fails With Exit 124

Exit `124` means Claude timed out. The default timeout is 30 minutes. Retry with
a narrower prompt, or pass CLI `--timeout-ms <milliseconds>` or MCP
`timeout_ms`.

## A Result Is Marked `degraded` / `ok: false`

Every result carries `ok` and `degraded`. A result is degraded when the run
timed out, Claude failed, the review diff could not be computed (for example a
`branch` review with no resolvable base), or Claude's output could not be parsed
into the structured review shape. The companion still preserves and returns
whatever it has — fetch the result, read `answer` and the raw output, and rerun
with a narrower scope or an explicit `base` if needed. Trust `ok` / `degraded`,
not the prose, before acting on a result.

## Background Job Looks Stale

Run:

```text
$claude status <job-id>
```

The status command refreshes queued or running jobs. If the worker PID is gone,
the job is marked failed instead of hanging forever.

## MCP Tool Is Missing

The skill can still fall back to the bundled script, but the best experience is
through the MCP tool. Rerun the installer and start a new Codex session:

```bash
curl -fsSL https://raw.githubusercontent.com/anhtaiH/claude-code-companion/main/install.sh | bash
```

## Install Exits Non-Zero

Exit `3` means a required step failed — adding the marketplace or the plugin.
Check that the Codex CLI is current and the source is reachable, then rerun.
MCP registration itself is best-effort: if your Codex build has no `codex mcp`
command, the installer prints a note and still exits `0`, and the `$claude`
skill keeps working.
