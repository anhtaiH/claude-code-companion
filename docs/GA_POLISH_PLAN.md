# GA Polish Plan

This plan tracks the path from a working companion to a low-friction GA tool.
The primary user is the Codex agent. The human should only install, authenticate
Claude Code, run setup, and then ask for a small number of natural workflows.

## Product Thesis

Claude Code Companion should feel like a built-in second-model capability for
Codex:

- Codex owns implementation, verification, and final judgment.
- Claude Code supplies deep read-only review, diagnosis, planning, research,
  and specialist critique.
- The human should not need to understand MCP tool arguments, job files, parser
  fallbacks, transcript recovery, or safety scanner details.
- The default path should run. Policy levers should exist, but should not make
  normal use brittle.

## Evidence Used

- Dogfood runs across Tarepack, Mains and Crosses, Orchard Park HOA, and the
  modeling repo.
- The reciprocal OpenAI companion design:
  https://github.com/openai/codex-plugin-cc
- A community reverse-port companion:
  https://github.com/pejmanjohn/cc-plugin-codex
- The current repository's test suite, plugin manifest, commands, skill, MCP
  schema, and runtime.
- Claude Code Companion dogfood jobs:
  - `task-mpvdzdyf-rgm5wr`: internal workflow research completed.
  - `task-mpvdz3hs-2lhwmz` and `task-mpvdz9s1-u4kgsu`: exposed timeout result
    persistence failure, now covered by tests.
  - `task-mpvklcco-td1gd1`: release-risk checkpoint focused on install,
    version, target semantics, and agent-facing UX.

## Problems Found

- Structured parsing was too strict, then too noisy. Markdown sections and
  companion notes could become bogus critical findings.
- Successful review results did not always preserve raw output, which made
  parser quality hard to audit.
- Repo-wide review was hidden behind `target: "none"` and was previously
  mislabeled as working-tree review.
- Status initially lacked model and effort, making runs harder to trust.
- Sensitive-context blocking created too much friction for normal dogfooding,
  especially when diffs intentionally contained fake secret fixtures.
- Output redaction produced false positives around benign secret-scanner
  discussion text.
- Timeout and empty-result paths could fail while summarizing instead of
  persisting a normal failed result.
- The command/API surface exposed too many details to the human and not enough
  decision guidance to Codex.
- An already-open Codex session can keep an older MCP schema after reinstall,
  so fresh-session guidance has to be explicit.
- Setup did not previously distinguish "Claude is installed" from "Claude is
  new enough for the companion's default flags."

## UX Lessons

- Keep one agent-native tool. Multiple low-level tools increase agent planning
  burden.
- Make review target selection obvious: `working_tree`, `branch`, or `repo`.
  Prompt-only tasks omit `target`.
- Prefer background for substantial work, but make status/result reliable and
  self-describing.
- Preserve full results. Do not make users recover transcripts for normal runs.
- Review commands should be review-only. Implementation remains Codex-owned.
- Internal workflow quality belongs behind the API: kind-specific prompting,
  specialist subagents, and concise result contracts should not expand the
  human-facing command set.
- Safety heuristics should warn by default and block only in explicit strict
  mode. Output redaction remains non-blocking and durable.

## Iteration Log

### Iteration 1: Public Standalone Shape

- Standalone public plugin repo with Apache-2.0 license and marketplace docs.
- Read-only Claude Code invocation with `Edit` and `Write` disallowed.
- Background job state, result files, MCP setup/status/result/cancel, and
  manifest validation.

### Iteration 2: Dogfood Durability

- Repo-wide review labeling fixed.
- Status records model and effort defaults.
- Parser accepts structured variants, grouped severity JSON, and markdown
  severity sections.
- Redacted raw output is preserved.
- OpenAI-key and private-key false positives reduced.

### Iteration 3: GA Friction Removal

- Sensitive-context detection warns by default and continues.
- Strict sensitive-context blocking remains available by flag.
- `repo` is a first-class MCP review target.
- Setup reports timeout and sensitive-context policy.
- Review results include companion health metadata.
- Task prompts include kind-specific internal workflow guidance.
- Default timeout increased to 30 minutes so broad background reviews are less
  likely to fail on wall-clock time. The docs now tell users to prefer
  background mode and add `--max-budget-usd` when they need a cost guard.
- Timeout/empty-result task failures persist normal failed results instead of
  crashing during summary generation.

### Iteration 4: Agent UX And Install Reliability

- Codex-facing docs now teach prompt-only tasks to omit `target`; only review
  calls use `working_tree`, `branch`, or `repo`.
- Setup reports Claude Code version compatibility and treats versions below
  `2.1.158` as not ready.
- The installer checks the Claude Code version before installing, supports
  `--uninstall`, and replaces manifest-created MCP entries with an absolute
  installed-cache command.
- Background job lookup can recover by job id after `cwd` drift, and `result`
  refreshes stale running jobs before returning.
- The package dry-run excludes tests and fake secret fixtures.

### Iteration 5: Final Dogfood Findings

- Installed repo-wide adversarial review completed through normal `status` and
  `result` with structured output and raw output preserved.
- MCP tool calls now use async child processes so a foreground delegate cannot
  block later lifecycle messages.
- Subagents now get the same git-read Bash allowlist as the main Claude run.
- Exception-failed background jobs persist a failed result, not only failed
  status.
- MCP inserts `--` before user prompt text so dash-leading text stays
  positional.
- Secret heuristics cover more common token shapes while remaining warn-first
  by default.

## Remaining GA Work

### P0 Before Broad GA

- Fresh-thread install smoke from the published marketplace path.
- Reinstall this branch and run:
  - `$claude setup`
  - repo-wide adversarial review with `target: "repo"`
  - deliberate sensitive-context diff in default warning mode
  - same diff in strict blocking mode
  - timeout smoke that persists a failed result
- Final self-review after the current diff is committed, so the companion can
  review the repository without uncommitted fake secret fixtures forcing policy
  decisions.

### P1 UX Polish

- Consider a `wait` option for MCP background jobs if Codex app support makes
  polling too manual.

### P2 Later Hardening

- Optional runtime config for team defaults: timeout, model, effort, strict
  sensitive-context mode.
- Better progress summaries while Claude is running, if Claude Code exposes
  stable progress events.
- More focused result schemas for non-review task kinds.
