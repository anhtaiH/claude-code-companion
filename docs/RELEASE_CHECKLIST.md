# Release Checklist

Use this checklist before tagging a public release.

## Local Gates

- [ ] `npm run check`
- [ ] `npm pack --dry-run`
- [ ] `npm pack --dry-run` contents reviewed; no unintended test fixtures or
  fake secrets ship in the archive.
- [ ] Plugin manifest validation passes.
- [ ] MCP initialize, tools/list, and tools/call smoke passes.
- [ ] `$claude setup` reports Claude Code `2.1.158` or newer as supported and
  older fake versions as not ready in tests.
- [ ] Installer can run twice in a row without leaving duplicate or stale MCP
  entries.
- [ ] Uninstall path is documented and smoke-tested.
- [ ] No live tracked secret-like content is present outside intentional test
  fixtures.

## Dogfood Gates

- [ ] `$claude setup` succeeds from a fresh Codex session.
- [ ] A deliberate secret-like diff records a warning by default.
- [ ] The same diff blocks before Claude is invoked with strict
  sensitive-context mode enabled.
- [ ] A background adversarial review completes through normal `status` and
  `result` calls.
- [ ] A background job can be fetched by job id even if the agent omits or
  changes `cwd` on the result call.
- [ ] The final adversarial review of this repo is reviewed and each finding is
  fixed or explicitly deferred.
- [ ] `docs/GA_POLISH_PLAN.md` is current with dogfood findings and release
  decisions.
- [ ] Fresh-thread install from `anhtaiH/claude-code-companion` can review this
  repo.

## GitHub Release

- [ ] Tag `v1.0.0`.
- [ ] Release notes include install instructions.
- [ ] Release notes explain read-only posture and sensitive-context warning mode.
- [ ] Release notes state that the default timeout is 30 minutes and there is no
  default dollar budget unless explicitly configured.
- [ ] Release notes link to troubleshooting and security policy.
