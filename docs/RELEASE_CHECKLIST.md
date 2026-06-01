# Release Checklist

Use this checklist before tagging a public release.

## Local Gates

- [ ] `npm run check`
- [ ] `npm pack --dry-run`
- [ ] Plugin manifest validation passes.
- [ ] MCP initialize, tools/list, and tools/call smoke passes.
- [ ] No tracked secret-like content is present.

## Dogfood Gates

- [ ] `$claude setup` succeeds from a fresh Codex session.
- [ ] A deliberate secret-like diff blocks before Claude is invoked.
- [ ] A background adversarial review completes through normal `status` and
  `result` calls.
- [ ] The final adversarial review of this repo is reviewed and each finding is
  fixed or explicitly deferred.
- [ ] Fresh-thread install from `anhtaiH/claude-code-companion` can review this
  repo.

## GitHub Release

- [ ] Tag `v1.0.0`.
- [ ] Release notes include install instructions.
- [ ] Release notes explain read-only posture and outbound context blocking.
- [ ] Release notes state that the default timeout is 15 minutes and there is no
  default dollar budget unless explicitly configured.
- [ ] Release notes link to troubleshooting and security policy.
