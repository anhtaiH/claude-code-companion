#!/usr/bin/env bash
set -euo pipefail

marketplace_name="${CLAUDE_CODE_COMPANION_MARKETPLACE:-claude-code-companion}"
plugin_name="${CLAUDE_CODE_COMPANION_PLUGIN:-claude}"
legacy_plugin_name="claude-code-companion"
source_spec="${CLAUDE_CODE_COMPANION_SOURCE:-anhtaiH/claude-code-companion}"
min_claude_version="2.1.158"

usage() {
  cat <<'USAGE'
Usage:
  install.sh              install or update Claude Code Companion
  install.sh --uninstall  remove the Codex plugin, marketplace, and MCP entry
USAGE
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

remove_existing() {
  codex plugin remove "${plugin_name}@${marketplace_name}" >/dev/null 2>&1 || true
  codex plugin remove "${legacy_plugin_name}@${marketplace_name}" >/dev/null 2>&1 || true
  codex plugin marketplace remove "${marketplace_name}" >/dev/null 2>&1 || true
  codex mcp remove "${marketplace_name}" >/dev/null 2>&1 || true
  codex mcp remove "${plugin_name}" >/dev/null 2>&1 || true
  codex mcp remove "${legacy_plugin_name}" >/dev/null 2>&1 || true
}

version_ge() {
  local left_major left_minor left_patch
  local right_major right_minor right_patch
  IFS=. read -r left_major left_minor left_patch <<<"$1"
  IFS=. read -r right_major right_minor right_patch <<<"$2"
  left_major="${left_major:-0}"
  left_minor="${left_minor:-0}"
  left_patch="${left_patch:-0}"
  right_major="${right_major:-0}"
  right_minor="${right_minor:-0}"
  right_patch="${right_patch:-0}"
  if (( left_major != right_major )); then
    (( left_major > right_major ))
    return
  fi
  if (( left_minor != right_minor )); then
    (( left_minor > right_minor ))
    return
  fi
  (( left_patch >= right_patch ))
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  --uninstall)
    need codex
    remove_existing
    printf 'Claude Code Companion removed from Codex.\n'
    state_root="${XDG_STATE_HOME:-$HOME/.local/state}/claude-code-companion"
    printf 'Job state, if present, remains under: %s\n' "${state_root}"
    exit 0
    ;;
  '')
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

need codex
need node
need claude

claude_version="$(
  claude --version 2>/dev/null |
    grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' |
    head -n 1 ||
    true
)"
if [[ "${claude_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  if ! version_ge "${claude_version}" "${min_claude_version}"; then
    printf 'Claude Code Companion requires Claude Code %s or newer; found %s.\n' "${min_claude_version}" "${claude_version}" >&2
    exit 1
  fi
else
  printf 'Warning: could not parse Claude Code version. Setup will verify compatibility after install.\n' >&2
fi

if ! claude auth status >/dev/null 2>&1; then
  printf 'Claude Code is installed but not authenticated. Run `claude auth login`, then rerun this installer.\n' >&2
  exit 1
fi

printf 'Installing Claude Code Companion for Codex...\n'

remove_existing

codex plugin marketplace add "${source_spec}"
install_output="$(codex plugin add "${plugin_name}@${marketplace_name}")"
printf '%s\n' "${install_output}"

plugin_root="$(
  printf '%s\n' "${install_output}" |
    sed -n 's/^Installed plugin root: //p' |
    tail -n 1
)"

if [[ -z "${plugin_root}" || ! -f "${plugin_root}/scripts/mcp-server.mjs" ]]; then
  printf 'Warning: could not locate installed plugin root for MCP registration.\n' >&2
  printf 'The $claude skill was installed. Start a new Codex session and run `$claude setup`.\n' >&2
  printf 'If the MCP tool is missing, reinstall after updating Codex or register it manually from the installed plugin root.\n' >&2
else
  codex mcp remove "${marketplace_name}" >/dev/null 2>&1 || true
  if ! codex mcp add "${marketplace_name}" -- node "${plugin_root}/scripts/mcp-server.mjs"; then
    printf 'Warning: MCP registration failed. The $claude skill fallback can still run the companion script.\n' >&2
  fi
fi

printf '\nInstalled. Start a new Codex session, then ask:\n'
printf '  $claude setup\n'
