# Claude Code Companion

Use Claude Code from inside Codex for reviews, diagnosis, planning, and
research.

This is a side helper. You stay in Codex, and Codex asks Claude Code when
another pass would help.

## What You Get

- `$claude-code-companion` skill guidance for Codex.
- `/claude:*` commands for common workflows.
- One `claude_code` MCP tool behind the scenes.
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
/claude:setup
```

If Claude Code is not signed in, sign in there first and run setup again.
Rerun the installer to update.

## Usage

Use the skill in natural language:

```text
$claude-code-companion review my current changes
```

Or use slash commands:

```text
/claude:review --focus "API compatibility"
/claude:adversarial-review --base main --background
/claude:diagnose the failing checkout test
/claude:plan the safest implementation path
/claude:research how auth is wired in this repo
```

For background work:

```text
/claude:status
/claude:result <job-id>
/claude:cancel <job-id>
```

## Commands

Core:

- `/claude:setup`
- `/claude:review`
- `/claude:adversarial-review`
- `/claude:diagnose`
- `/claude:plan`
- `/claude:research`

Focused passes:

- `/claude:test-gap-review`
- `/claude:spec-audit`
- `/claude:pr-review-prep`
- `/claude:release-risk`
- `/claude:architecture-critique`
- `/claude:refactor-plan`
- `/claude:log-diagnose`
- `/claude:dependency-review`
- `/claude:security-review`

Job control:

- `/claude:status`
- `/claude:result`
- `/claude:cancel`

Review commands accept:

```text
[--base <ref>] [--scope auto|working-tree|branch] [--focus <text>]
[--background] [--model <model>] [--effort low|medium|high|xhigh|max]
[--timeout-ms <ms>]
```

Task commands accept:

```text
[--background] [--resume-last|--fresh] [--focus <text>]
[--model <model>] [--effort low|medium|high|xhigh|max]
[--timeout-ms <ms>] [prompt]
```

## How It Works

Claude Code Companion installs as the `claude` Codex plugin. The commands and
skill route Codex into the same `claude_code` MCP tool.

The tool uses your local Claude Code CLI and your existing Claude Code login.
By default it asks Claude Code for `opus[1m]` with `max` effort and dynamic
workflows. Claude can inspect the repo with read-only tools. It does not edit
files.
Usage is handled by your Claude Code plan; the companion does not set a
per-call budget.

## Manual Install

The installer runs:

```bash
codex plugin marketplace add anhtaiH/claude-code-companion
codex plugin add claude@claude-code-companion
```

## Development

```bash
git clone https://github.com/anhtaiH/claude-code-companion.git
cd claude-code-companion
npm run check
```

The tests use a fake `claude` binary, so they do not spend Claude credits.

## License

Apache-2.0. See [LICENSE](LICENSE).
