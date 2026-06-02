// Single source of truth for the companion's delegation surface.
//
// The companion exposes five kinds: two diff-review kinds plus three task
// kinds. Specialist angles (security, tests, release risk, architecture, logs,
// dependencies, spec, PR prep) are expressed through the `focus` argument and
// the always-injected read-only subagents rather than as separate kinds. This
// keeps the public `kind` enum small and removes the drift hazard of
// maintaining near-identical presets in several places.
//
// Both the CLI orchestrator and the MCP server import from here so the enum,
// the per-kind prompt guidance, and validation can never diverge.

export const REVIEW_KINDS = ['review', 'adversarial_review'];

// The generic kind used when a task is delegated without a specific mode (for
// example the bundled-script skill fallback). Always valid.
export const GENERIC_TASK_KIND = 'task';

export const TASK_WORKFLOWS = {
  diagnose: [
    'Diagnose mode: identify the likely root cause, the evidence for it, and the narrowest next verification step.',
    'Use log-diagnostician for logs, stack traces, or failing command output. Use codebase-researcher when the relevant code path is unclear.',
    'Do not propose broad rewrites before ruling out configuration, environment, and recent-change causes.',
  ],
  plan: [
    'Plan mode: produce a concrete implementation plan with ordering, verification, risks, and rollback or escape hatches when relevant.',
    'Use codebase-researcher first for unfamiliar areas and architecture-critic for design tradeoffs, coupling, and refactor sequencing.',
    'Prefer a plan Codex can execute without follow-up questions.',
  ],
  research: [
    'Research mode: map the relevant files, conventions, dependencies, specs, and facts Codex should know before acting.',
    'Use codebase-researcher for reconnaissance. Separate observed facts from inferences and cite file paths or command evidence when available.',
  ],
};

export const TASK_KINDS = Object.keys(TASK_WORKFLOWS);

export const ALL_KINDS = [...REVIEW_KINDS, ...TASK_KINDS];

// Kinds that handleTask accepts as a --kind value: the real task kinds plus the
// generic fallback. Review kinds are dispatched through their own subcommands.
export const VALID_TASK_KIND_VALUES = [...TASK_KINDS, GENERIC_TASK_KIND];

const GENERIC_WORKFLOW = [
  'General task mode: inspect only what is needed, synthesize findings for Codex, and keep the result actionable.',
];

export function workflowForTaskKind(kind) {
  const baseKind = String(kind ?? '').replace(/-resume$/, '');
  if (baseKind === GENERIC_TASK_KIND || baseKind === '') return GENERIC_WORKFLOW;
  return TASK_WORKFLOWS[baseKind] ?? GENERIC_WORKFLOW;
}

export function isValidTaskKind(kind) {
  return VALID_TASK_KIND_VALUES.includes(
    String(kind ?? '').replace(/-resume$/, ''),
  );
}
