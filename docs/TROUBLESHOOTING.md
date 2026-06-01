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

## Review Blocks With Exit Code 2

Exit code `2` means the companion found secret-like outbound context before it
called Claude. It scans tracked diffs, untracked file bodies, task prompts,
focus text, and repo instruction context.

Remove the secret-like content from the diff or prompt before retrying. If the
content is intentional and approved for Claude, use CLI
`--allow-sensitive-context` or MCP `allow_sensitive_context: true`.

## Result Contains Redactions

Redactions in a stored result mean Claude returned text that looked like a
token, password, private key, or similar secret. The companion redacts that
output and keeps the result so `status` and `result` still work.

## Job Fails With Exit 124

Exit `124` means Claude timed out. The default timeout is 15 minutes. Retry with
a narrower prompt, or pass CLI `--timeout-ms <milliseconds>` or MCP
`timeout_ms`.

## Review Says Claude Output Could Not Be Parsed

The companion persists malformed or prose review output as a
`needs-attention` result instead of discarding it. Fetch the normal result,
inspect the redacted raw output, then rerun with a narrower focus if needed.

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
