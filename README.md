# Claude Code Companion

Use Claude Code from inside Codex for review, diagnosis, planning, and research.
Codex stays in charge; Claude is the side helper.

This is the canonical public repository for the `claude` Codex plugin.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/anhtaiH/claude-code-companion/main/install.sh | bash
```

Start a new Codex session after installing.

Then ask Codex:

```text
$claude setup
```

If Claude Code is not signed in, run `claude auth login` and rerun the
installer.

More detail: [docs/INSTALL.md](docs/INSTALL.md).

## Usage

Use `$claude` in normal chat:

```text
$claude review my current changes
$claude review the whole repo
$claude adversarial review against main, focus auth and rollback
$claude diagnose the failing checkout test
$claude plan the safest implementation path
$claude research how auth is wired in this repo
```

For background work:

```text
$claude status
$claude result <job-id>
$claude cancel <job-id>
```

Useful passes:

- review
- adversarial review
- diagnose
- plan
- research
- test gap review
- spec audit
- PR review prep
- release risk
- architecture critique
- refactor plan
- log diagnose
- dependency review
- security review

You can add details in plain English, for example:

```text
$claude test gap review this branch, focus the new billing tests, run in background
$claude security review the auth changes against main
$claude log diagnose this CI failure: <paste logs>
```

## How It Works

The installer adds the `claude` Codex plugin and registers the companion MCP
server as `claude-code-companion`. The `$claude` skill uses the MCP tool when
Codex exposes it. If the app only loads the skill, the agent falls back to the
bundled companion script automatically.

The companion uses your local Claude Code CLI and existing Claude Code login.
By default it asks Claude Code for `opus[1m]` with `max` effort and dynamic
workflows. Claude can inspect the repo with read-only tools. It does not edit
files.

Under the hood, Claude also gets read-only specialist subagents for codebase
research, test gaps, security, architecture, release risk, and log diagnosis.
Claude manages that internal work and returns one synthesized result to Codex.

Before review calls, the companion scans tracked diffs, untracked file bodies,
focus text, and repo instruction context for secret-like content. Before task
calls, it scans the task prompt and repo instruction context. The default is
low-friction: it records a warning and continues. Use
`--strict-sensitive-context` or MCP `strict_sensitive_context` when a team wants
heuristic secret-like context to block before Claude is called.

Usage is handled by your Claude Code plan. The companion sets a 30-minute
timeout by default so deep background reviews have room to finish, and it does
not set a per-call dollar budget unless you pass `--max-budget-usd` or MCP
`max_budget_usd`. For long or broad delegations, prefer background mode; add a
budget guard when your environment needs one.

Optional output redaction is separate from outbound blocking: if Claude quotes
text that looks like a token or password, the stored result is redacted and kept
so the job remains inspectable.

The secret-like scan is a conservative heuristic, not a full secret scanner.
Run your normal secret-scanning tooling before publishing a repository.

## Requirements

- Codex CLI with plugin and MCP support.
- Claude Code CLI installed and signed in.
- Node.js 20 or newer.
- Git for diff-based reviews.

## Release And Support

- License: Apache-2.0.
- Publisher: Anhtai Huynh.
- GitHub: https://github.com/anhtaiH/claude-code-companion.
- Security policy: [SECURITY.md](SECURITY.md).
- Troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
- Release checklist: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).
- GA polish plan: [docs/GA_POLISH_PLAN.md](docs/GA_POLISH_PLAN.md).

## Development

```bash
git clone https://github.com/anhtaiH/claude-code-companion.git
cd claude-code-companion
npm run check
```

The tests use a fake `claude` binary, so they do not spend Claude credits.

## License

Apache-2.0. See [LICENSE](LICENSE).
