# Claude Code Companion

Use Claude Code from inside Codex for reviews, diagnosis, planning, and
research.

This is a side helper for the Codex agent. You stay in Codex, and Codex asks
Claude Code when another model family would be useful.

## What You Get

- A `claude_code` helper that Codex can call.
- Review and adversarial review for current changes.
- Diagnosis, planning, and repository research.
- Background jobs with status, result, and cancel support.
- A setup check for your local Claude Code install and login.

## Requirements

- Codex CLI with plugin and MCP support.
- Claude Code CLI installed and signed in.
- Node.js 18.18 or newer.
- Git for diff-based reviews.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/anhtaiH/claude-code-companion/main/install.sh | bash
```

Start a new Codex session after installing.

Then ask Codex:

```text
Use Claude Code Companion to check setup.
```

The setup check is the equivalent of `/codex:setup` in
`openai/codex-plugin-cc`: it tells you whether the local helper is ready. If
Claude Code is not signed in, sign in there first and run setup again.

Rerun the installer to update.

## Usage

Ask Codex naturally from the project you are working in:

```text
Use Claude Code Companion to review my current changes.
```

```text
Ask Claude Code Companion for an adversarial review before shipping. Focus on
auth, rollback, and data loss.
```

```text
Ask Claude Code Companion to diagnose why the test suite is failing.
```

```text
Ask Claude Code Companion to plan the safest implementation path.
```

For longer work, ask Codex to run it in the background:

```text
Use Claude Code Companion to run an adversarial review in the background.
```

Then check in from the same Codex session:

```text
Use Claude Code Companion to show status.
```

```text
Use Claude Code Companion to get the result.
```

You should not need to run `claude` directly for normal plugin use.

## How It Works

Claude Code Companion installs as a Codex plugin. The plugin gives Codex one MCP
tool, `claude_code`, plus a skill that tells Codex when to use it.

The tool uses your local Claude Code CLI and your existing Claude Code login.
Claude's output is advisory. Codex remains the main agent and decides what to
present, verify, or edit next.

V1 asks Claude Code for review, diagnosis, planning, and research. It does not
ask Claude Code to edit files.

## Manual Install

The one-line installer runs these Codex commands:

```bash
codex plugin marketplace add anhtaiH/claude-code-companion
codex plugin add claude-code-companion@claude-code-companion
```

Use this only if you want to see or run the steps yourself.

## Development

```bash
git clone https://github.com/anhtaiH/claude-code-companion.git
cd claude-code-companion
npm run check
```

The tests use a fake `claude` binary, so they do not spend Claude credits.

## License

Apache-2.0. See [LICENSE](LICENSE).
