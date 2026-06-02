#!/usr/bin/env bash
set -euo pipefail

marketplace_name="${CLAUDE_CODE_COMPANION_MARKETPLACE:-claude-code-companion}"
plugin_name="${CLAUDE_CODE_COMPANION_PLUGIN:-claude}"
legacy_plugin_name="claude-code-companion"
# Installs from main by default. Pin a release with
# CLAUDE_CODE_COMPANION_SOURCE='anhtaiH/claude-code-companion@<tag>'.
source_spec="${CLAUDE_CODE_COMPANION_SOURCE:-anhtaiH/claude-code-companion}"
min_claude_version="2.1.158"
# Exit code for a genuinely fatal install failure (marketplace or plugin add).
# MCP registration stays best-effort: the $claude skill can run the companion
# script even when the MCP tool is absent.
exit_plugin_add_failed=3

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

report_remove() {
  local verbose="$1" label="$2"
  shift 2
  if "$@" >/dev/null 2>&1; then
    if [[ "${verbose}" == "verbose" ]]; then
      printf '  removed: %s\n' "${label}"
    fi
  elif [[ "${verbose}" == "verbose" ]]; then
    printf '  not present: %s\n' "${label}"
  fi
}

remove_existing() {
  local verbose="${1:-quiet}"
  report_remove "${verbose}" "plugin ${plugin_name}" \
    codex plugin remove "${plugin_name}@${marketplace_name}"
  report_remove "${verbose}" "plugin ${legacy_plugin_name}" \
    codex plugin remove "${legacy_plugin_name}@${marketplace_name}"
  report_remove "${verbose}" "marketplace ${marketplace_name}" \
    codex plugin marketplace remove "${marketplace_name}"
  report_remove "${verbose}" "mcp ${marketplace_name}" \
    codex mcp remove "${marketplace_name}"
  report_remove "${verbose}" "mcp ${plugin_name}" \
    codex mcp remove "${plugin_name}"
  report_remove "${verbose}" "mcp ${legacy_plugin_name}" \
    codex mcp remove "${legacy_plugin_name}"
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
    printf 'Removing Claude Code Companion from Codex...\n'
    remove_existing verbose
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

if ! codex plugin marketplace add "${source_spec}"; then
  printf 'Error: could not add the marketplace %s. Check the source and your Codex version.\n' "${source_spec}" >&2
  exit "${exit_plugin_add_failed}"
fi
if ! install_output="$(codex plugin add "${plugin_name}@${marketplace_name}")"; then
  printf 'Error: could not add the %s plugin from %s.\n' "${plugin_name}" "${marketplace_name}" >&2
  exit "${exit_plugin_add_failed}"
fi
printf '%s\n' "${install_output}"

plugin_root="$(
  printf '%s\n' "${install_output}" |
    sed -n 's/^Installed plugin root: //p' |
    tail -n 1
)"

if [[ -z "${plugin_root}" || ! -f "${plugin_root}/scripts/mcp-server.mjs" ]]; then
  printf 'Note: could not locate the installed plugin root for explicit MCP registration (non-fatal).\n' >&2
  printf 'The plugin manifest still registers the MCP server, and the $claude skill can run the companion script either way.\n' >&2
  printf 'Start a new Codex session and run `$claude setup` to verify the tool.\n' >&2
elif ! codex mcp --help >/dev/null 2>&1; then
  printf 'Note: this Codex build does not support `codex mcp`; skipping explicit MCP registration (non-fatal).\n' >&2
  printf 'The plugin manifest still registers the MCP server and the $claude skill fallback works.\n' >&2
else
  codex mcp remove "${marketplace_name}" >/dev/null 2>&1 || true
  if ! codex mcp add "${marketplace_name}" -- node "${plugin_root}/scripts/mcp-server.mjs"; then
    printf 'Note: explicit MCP registration failed (non-fatal). The $claude skill fallback can still run the companion script.\n' >&2
  fi
fi

printf '\nInstalled. Start a NEW Codex session before using it — an already-open\n'
printf 'session caches the previous MCP schema after an install or upgrade. Then ask:\n'
printf '  $claude setup\n'
