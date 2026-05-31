#!/usr/bin/env bash
set -euo pipefail

marketplace_name="${CLAUDE_CODE_COMPANION_MARKETPLACE:-claude-code-companion}"
plugin_name="${CLAUDE_CODE_COMPANION_PLUGIN:-claude-code-companion}"
source_spec="${CLAUDE_CODE_COMPANION_SOURCE:-anhtaiH/claude-code-companion}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

need codex
need node
need claude

if ! claude auth status >/dev/null 2>&1; then
  printf 'Claude Code is installed but not authenticated. Run `claude auth login`, then rerun this installer.\n' >&2
  exit 1
fi

printf 'Installing Claude Code Companion for Codex...\n'

codex plugin remove "${plugin_name}@${marketplace_name}" >/dev/null 2>&1 || true
codex plugin marketplace remove "${marketplace_name}" >/dev/null 2>&1 || true

codex plugin marketplace add "${source_spec}"
codex plugin add "${plugin_name}@${marketplace_name}"

printf '\nInstalled. Start a new Codex session, then ask:\n'
printf '  Use Claude Code Companion to check setup.\n'
