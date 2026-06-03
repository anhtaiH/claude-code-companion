# Claude Code Companion

Use Claude Code from inside Codex for a read-only second opinion — review,
diagnosis, planning, and research. Codex stays in charge; Claude is the side
helper and never edits files.

This is the canonical public repository for the `claude` Codex plugin.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/anhtaiH/claude-code-companion/main/install.sh | bash
```

Start a **new** Codex session (an already-open session caches the old tool
schema), then:

```text
$claude setup
$claude review this repo
```

If Claude Code is not signed in, run `claude auth login` and rerun the
installer. More detail: [docs/INSTALL.md](docs/INSTALL.md).

## Use

Type `$claude` in normal Codex chat. There are five passes:

```text
$claude review my current changes
$claude adversarial review against main, focus auth and rollback
$claude diagnose the failing checkout test
$claude plan the safest path to add billing
$claude research how auth is wired in this repo
```

For a specialist angle — security, tests, release risk, architecture, logs,
dependencies, spec, or PR prep — pick the closest pass and name the focus in
plain English (`$claude review the auth changes, focus on secrets`). The
read-only specialist subagents run either way.

Substantial work can run in the background and return a job id to poll:

```text
$claude status
$claude result <job-id>
$claude cancel <job-id>
```

## Tips

- **Trust `ok` / `degraded`, not just the prose.** Every result is JSON with
  `ok` (false when the run failed or was degraded), `degraded`, and `answer`.
  Reviews also carry `verdict` and `findings` by severity.
- **Background the big jobs.** Deep reviews and research can take a while; start
  them in the background and fetch the result later. The default timeout is 30
  minutes.
- **Focus narrows the lens** instead of reaching for a separate command.
- **Cheap probes.** For a smoke/ping call, add `--cost-preset cheap` (MCP
  `cost_preset`) to use a smaller model at low effort; an explicit `--model` or
  `--effort` overrides it. A review of a clean working tree returns instantly
  without calling Claude.
- **Block secret-like context** with `--strict-sensitive-context` (MCP
  `strict_sensitive_context`) when you want a run to stop rather than warn.
- **Restart Codex after upgrading** so the new tool schema loads.

## How it works

The installer adds the `claude` Codex plugin and registers the
`claude-code-companion` MCP server. `$claude` calls the MCP tool when Codex
exposes it, and otherwise falls back to the bundled companion script.

The companion drives your local Claude Code CLI and login. By default it asks
for Opus 4.8 (1M context) at max effort with dynamic workflows, plus read-only
specialist subagents for code research, test gaps, security, architecture,
release risk, and log diagnosis. Claude inspects the repo with read-only tools
only — it never edits files, and that boundary is enforced at the MCP, CLI, and
Claude-argument layers.

Before each call the companion scans the diff, untracked files, your prompt, and
repo instructions for secret-like content. By default it records a warning and
continues; strict mode blocks instead. Separately, if Claude's output quotes
something that looks like a secret, the stored result is redacted but kept so the
job stays inspectable. This scan is a conservative heuristic, not a full secret
scanner — run your normal tooling before publishing.

Usage runs on your Claude Code plan. No per-call dollar budget is set unless you
pass `--max-budget-usd` / `max_budget_usd`.

## For Codex agents

Treat this as one high-level helper, not a set of shell commands:

- Call `setup` when readiness is unknown; a not-ready environment exits non-zero.
- Pass the workspace root as `cwd` on every call.
- Targets: `working_tree` for current changes, `branch` + `base` for branch
  review, `repo` for the whole repository. Omit the target for diagnosis,
  planning, and research.
- Start substantial work in the background, poll `status`, then fetch `result`.
  Check `ok` / `degraded` before trusting a result.
- Keep implementation and final judgment in Codex. Claude is advisory unless the
  human switches tools.

## Requirements

- Codex CLI with plugin and MCP support.
- Claude Code CLI `2.1.158` or newer, installed and signed in.
- Node.js 20 or newer, and Git.

## Support

- License: Apache-2.0 · Publisher: Anhtai Huynh
- [Install guide](docs/INSTALL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
  · [Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md)
- Issues: https://github.com/anhtaiH/claude-code-companion/issues

## Development

```bash
git clone https://github.com/anhtaiH/claude-code-companion.git
cd claude-code-companion
npm run check
```

Tests use a fake `claude` binary, so they spend no Claude credits.

## License

Apache-2.0. See [LICENSE](LICENSE).
