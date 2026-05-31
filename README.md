# Claude Code Companion

Use Claude Code from inside Codex for review, diagnosis, planning, and research.
Codex stays in charge; Claude is the side helper.

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

## Usage

Use `$claude` in normal chat:

```text
$claude review my current changes
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

Usage is handled by your Claude Code plan; the companion does not set a
per-call budget.

## Requirements

- Codex CLI with plugin and MCP support.
- Claude Code CLI installed and signed in.
- Node.js 18.18 or newer.
- Git for diff-based reviews.

## Development

```bash
git clone https://github.com/anhtaiH/claude-code-companion.git
cd claude-code-companion
npm run check
```

The tests use a fake `claude` binary, so they do not spend Claude credits.

## License

Apache-2.0. See [LICENSE](LICENSE).
