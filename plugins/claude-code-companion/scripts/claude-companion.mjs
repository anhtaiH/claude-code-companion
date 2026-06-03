#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import {
  ensureClaudeReady,
  getClaudeAuthStatus,
  getClaudeAvailability,
  getClaudeDefaults,
  normalizeReviewPayload,
  readJsonSchema,
  runClaudePrint,
} from './lib/claude.mjs';
import { isValidTaskKind, workflowForTaskKind } from './lib/kinds.mjs';
import {
  collectRepoInstructions,
  collectReviewContext,
  resolveReviewTarget,
  resolveWorkspaceRoot,
} from './lib/git.mjs';
import {
  binaryAvailable,
  isPidRunning,
  jobLiveness,
  nowIso,
  terminateProcessTree,
} from './lib/process.mjs';
import {
  renderQueued,
  renderReviewResult,
  renderSetup,
  renderStatus,
  renderStoredResult,
  renderTaskResult,
} from './lib/render.mjs';
import {
  appendLogLine,
  ensureStateDir,
  findJob,
  findIndexedWorkspaceRoot,
  findLatestCompletedTask,
  generateJobId,
  listJobs,
  readJobFile,
  readLogPreview,
  readResultFile,
  resolveJobLogFile,
  resolveJobResultFile,
  resolveStateDir,
  sortJobsNewestFirst,
  upsertJob,
  writeJobFile,
  writeResultFile,
} from './lib/state.mjs';
import {
  blockSensitiveContext,
  redactSecretLikeText,
  redactSensitivePayload,
} from './lib/safety.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const REVIEW_SCHEMA_PATH = path.join(
  ROOT_DIR,
  'schemas',
  'review-output.schema.json',
);
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CONTINUE_PROMPT =
  'Continue from the current Claude Code companion session. Stay read-only and return the next useful diagnosis or plan.';

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/claude-companion.mjs setup [--cwd <path>] [--json]',
      '  node scripts/claude-companion.mjs review [--background] [--base <ref>] [--scope auto|working-tree|branch|repo] [--model <model>] [--effort <level>] [--timeout-ms <ms>] [--strict-sensitive-context] [--json]',
      '  node scripts/claude-companion.mjs adversarial-review [same flags as review] [focus text]',
      '  node scripts/claude-companion.mjs task [--kind <kind>] [--background] [--resume-last|--resume] [--fresh] [--model <model>] [--effort <level>] [--strict-sensitive-context] [prompt]',
      '  node scripts/claude-companion.mjs status [job-id] [--all] [--json]',
      '  node scripts/claude-companion.mjs result [job-id] [--json]',
      '  node scripts/claude-companion.mjs cancel [job-id] [--json]',
    ].join('\n'),
  );
}

function output(payload, rendered, asJson) {
  process.stdout.write(
    asJson ? `${JSON.stringify(payload, null, 2)}\n` : rendered,
  );
}

// Validate --timeout-ms up front. An unparseable, negative, fractional, or zero
// value would otherwise reach spawnSync and either throw an opaque RangeError
// (foreground) or be serialized to null and silently disable the timeout
// (background). Reject it here with a message that names the offending flag.
// Optional cost presets for cheap probe/ping calls. A preset only fills in
// model/effort the caller did not set explicitly — an explicit --model/--effort
// always wins. The default (no preset) stays opus[1m]/max for real work.
const COST_PRESETS = {
  cheap: { model: 'haiku', effort: 'low' },
};

function resolveCostPreset(options) {
  const name = options['cost-preset'];
  if (name === undefined) return {};
  const preset = COST_PRESETS[name];
  if (!preset) {
    throw new Error(
      `Unknown cost preset "${name}". Use: ${Object.keys(COST_PRESETS).join(', ')}.`,
    );
  }
  return preset;
}

function coerceTimeoutMs(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `--timeout-ms must be a positive integer number of milliseconds; received "${raw}".`,
    );
  }
  return value;
}

function resolveCwd(options = {}) {
  return path.resolve(process.cwd(), options.cwd ?? '.');
}

function readPipedStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function loadPromptTemplate(name) {
  return fs.readFileSync(path.join(ROOT_DIR, 'prompts', `${name}.md`), 'utf8');
}

function interpolate(template, values) {
  let text = template;
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`{{${key}}}`, String(value ?? ''));
  }
  return text;
}

function rejectWriteOptions(options) {
  const disallowed = [
    'write',
    'edit',
    'dangerously-skip-permissions',
    'allow-dangerously-skip-permissions',
    'permission-mode',
  ];
  const found = disallowed.filter((key) => options[key] !== undefined);
  if (found.length) {
    throw new Error(
      `Claude Code Companion is read-only; refusing option(s): ${found.join(', ')}`,
    );
  }
}

// Probe-write a temp file in the state dir so setup doubles as a no-model
// readiness/ping check: an unwritable state dir means jobs cannot be persisted.
function probeStateWritable(workspaceRoot) {
  try {
    const dir = resolveStateDir(workspaceRoot);
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function buildSetupReport(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  ensureStateDir(workspaceRoot);
  const node = binaryAvailable('node', ['--version'], { cwd });
  const claude = getClaudeAvailability(cwd);
  const auth = claude.available
    ? getClaudeAuthStatus(cwd)
    : { loggedIn: false, detail: 'Claude Code is not installed.' };
  const stateWritable = probeStateWritable(workspaceRoot);
  const nextSteps = [];
  if (!claude.available) nextSteps.push('Install Claude Code and rerun setup.');
  if (claude.available && claude.supported === false) {
    nextSteps.push(
      `Update Claude Code to ${claude.minimumVersion} or newer and rerun setup.`,
    );
  }
  if (claude.available && !auth.loggedIn)
    nextSteps.push('Run `claude auth login`.');
  if (!stateWritable)
    nextSteps.push('Fix permissions on the companion state directory.');

  return {
    ready:
      node.available &&
      claude.available &&
      claude.supported !== false &&
      auth.loggedIn &&
      stateWritable,
    node,
    claude,
    auth,
    stateWritable,
    workspaceRoot,
    stateDir: resolveStateDir(workspaceRoot),
    defaults: getClaudeDefaults(),
    policy: {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxBudgetUsd: null,
      sensitiveContext: 'warn',
      strictSensitiveContextFlag: '--strict-sensitive-context',
    },
    warnings:
      claude.available && claude.supported === null
        ? [
            `Claude Code version could not be parsed from "${claude.detail}". Tested default setup requires ${claude.minimumVersion} or newer.`,
          ]
        : [],
    nextSteps,
  };
}

function buildJob(workspaceRoot, request) {
  const id = generateJobId(request.jobClass === 'review' ? 'review' : 'task');
  const logFile = resolveJobLogFile(workspaceRoot, id);
  const resultFile = resolveJobResultFile(workspaceRoot, id);
  const defaults = getClaudeDefaults();
  return {
    id,
    workspaceRoot,
    kind: request.kind,
    jobClass: request.jobClass,
    status: 'queued',
    phase: 'queued',
    pid: null,
    sessionId: null,
    model: request.model ?? defaults.model,
    effort: request.effort ?? defaults.effort,
    scope: request.scope ?? request.base ?? null,
    // The summary is display-only and shown by `status`; redact secret-like
    // text so a leaked-looking prompt is not stored or surfaced in the clear.
    summary: redactSecretLikeText(request.summary),
    logFile,
    resultFile,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function safePersistResult(workspaceRoot, jobId, payload) {
  return writeResultFile(workspaceRoot, jobId, payload);
}

function renderExecutionPayload(payload, fallback = '') {
  if (payload?.review) {
    return renderReviewResult({
      reviewName: payload.reviewName,
      targetLabel: payload.targetLabel,
      sessionId: payload.sessionId,
      review: payload.review,
      parseError: payload.parseError,
      warnings: payload.warnings,
      companion: payload.companion,
    });
  }
  if (Object.hasOwn(payload ?? {}, 'rawOutput')) return renderTaskResult(payload);
  return fallback || `${JSON.stringify(payload, null, 2)}\n`;
}

function finalizeExecution(execution) {
  const redacted = redactSensitivePayload(execution.payload);
  if (!redacted.redactions.length) return execution;
  return {
    ...execution,
    payload: redacted.payload,
    rendered: renderExecutionPayload(redacted.payload, execution.rendered),
    summary: redactSecretLikeText(execution.summary),
  };
}

function warningForSensitiveContext(findings) {
  if (!findings.length) return [];
  return [
    {
      type: 'sensitive-context-detected',
      message:
        'Sensitive-looking outbound context was detected and sent to Claude. Use --strict-sensitive-context to block instead.',
      findings,
    },
  ];
}

function buildDiffBlock(context) {
  if (context.diffError) {
    return `Git diff failed: ${context.diffError}`;
  }
  if (!context.diff.trim()) return '(no tracked diff)';
  return ['```diff', context.diff.trimEnd(), '```'].join('\n');
}

function buildReviewPrompt(context, reviewName, focusText) {
  const template = loadPromptTemplate(
    reviewName === 'Adversarial Review' ? 'adversarial-review' : 'review',
  );
  return interpolate(template, {
    TARGET_LABEL: context.target.label,
    REPO_CONTEXT: context.repoContext,
    GIT_CONTEXT: context.gitContext,
    DIFF: buildDiffBlock(context),
    UNTRACKED: context.untracked.rendered,
    FOCUS: focusText || 'No extra focus provided.',
  });
}

function reviewSensitiveSources(context, focusText) {
  return [
    {
      sourceKind: 'tracked-diff',
      path: context.target.label,
      text: context.diffScanText,
    },
    {
      sourceKind: 'focus-text',
      text: focusText,
    },
    {
      sourceKind: 'repo-instructions',
      text: context.repoContext,
    },
    {
      sourceKind: 'git-context',
      text: context.gitContext,
    },
    ...context.untracked.entries.map((entry) => ({
      sourceKind: 'untracked-file',
      path: entry.path,
      text: entry.content,
    })),
  ];
}

function fallbackReview(summary) {
  return {
    verdict: 'needs-attention',
    summary,
    findings: [],
    next_steps: ['Rerun the Claude review or inspect the companion logs.'],
  };
}

function exceptionFailurePayload(job, request, errorMessage) {
  if (job.jobClass === 'review') {
    const review = fallbackReview(
      `Claude ${job.kind} failed before producing a result: ${errorMessage}`,
    );
    return {
      ok: false,
      kind: request.kind ?? job.kind,
      degraded: true,
      answer: review.summary,
      reviewName: request.reviewName ?? 'Review',
      targetLabel: request.summary ?? 'review',
      sessionId: null,
      review,
      parseError: null,
      rawOutput: errorMessage,
      warnings: [],
      companion: {
        resultKind: 'failed-review',
        rawOutput: 'preserved',
        targetScope: request.scope ?? null,
        targetLabel: request.summary ?? null,
        parser: 'not-run',
        parseError: null,
        sensitiveContext: 'unknown',
        model: null,
      },
    };
  }

  return {
    ok: false,
    kind: request.kind ?? job.kind,
    degraded: true,
    answer: errorMessage,
    rawOutput: errorMessage,
    sessionId: null,
    companion: {
      resultKind: 'failed-task',
      rawOutput: 'preserved',
      sensitiveContext: 'unknown',
      model: null,
      resultTextSource: 'exception',
    },
    claude: {
      status: 1,
      error: errorMessage,
      stderr: '',
      totalCostUsd: null,
      usage: null,
      modelUsage: null,
      effectiveModels: [],
      eventCount: 0,
      terminalReason: 'exception',
      resultTextSource: 'exception',
    },
    warnings: [],
  };
}

function effectiveModelName(claude) {
  if (!Array.isArray(claude.effectiveModels)) return null;
  return claude.effectiveModels[0] ?? null;
}

function reviewCompanionHealth({ parsed, claude, target, sensitiveContext }) {
  return {
    resultKind: parsed.parseError ? 'fallback-review' : 'structured-review',
    rawOutput: 'preserved',
    targetScope: target.mode,
    targetLabel: target.label,
    parser: parsed.parseError ? 'fallback' : 'ok',
    parseError: parsed.parseError ?? null,
    sensitiveContext: sensitiveContext.length ? 'warned' : 'clear',
    model: effectiveModelName(claude),
    resultTextSource: claude.resultTextSource,
  };
}

function reviewAnswer(review) {
  const count = review.findings.length;
  const suffix = count
    ? ` (${count} finding${count === 1 ? '' : 's'})`
    : '';
  return `${review.verdict}: ${review.summary}${suffix}`;
}

function degradedReviewResult(request, target, context) {
  const reviewName = request.reviewName;
  const review = fallbackReview(
    `Could not compute the review diff for ${target.label}: ${context.diffError}. No review was performed; pass an explicit base ref or verify the branch exists.`,
  );
  const companion = {
    resultKind: 'diff-error',
    rawOutput: 'preserved',
    targetScope: target.mode,
    targetLabel: target.label,
    parser: 'not-run',
    parseError: null,
    sensitiveContext: 'unknown',
    model: null,
  };
  return {
    exitStatus: 1,
    rendered: renderReviewResult({
      reviewName,
      targetLabel: target.label,
      sessionId: null,
      review,
      parseError: null,
      warnings: [],
      companion,
    }),
    payload: {
      ok: false,
      kind: request.kind,
      degraded: true,
      answer: reviewAnswer(review),
      reviewName,
      targetLabel: target.label,
      sessionId: null,
      review,
      parseError: null,
      rawOutput: context.diffError,
      warnings: [],
      companion,
      context: {
        repoRoot: context.repoRoot,
        branch: context.branch,
        shortstat: context.shortstat,
        diffError: context.diffError,
        untracked: context.untracked.names,
      },
      claude: null,
    },
    sessionId: null,
    summary: review.summary,
  };
}

// True when there is genuinely nothing to review, so we can answer locally
// without spending a Claude invocation. Repo scope is never "empty" (it reviews
// the whole tree). Uses the full untruncated diff text, not the prompt-truncated
// copy.
function isEmptyReviewTarget(target, context) {
  if (target.mode === 'repo') return false;
  const noDiff = !String(context.diffScanText ?? '').trim();
  if (target.mode === 'working-tree') {
    // A failed untracked listing reports names:[] too; never treat that as
    // empty, or a git error would silently suppress the whole review.
    if (context.untracked.listed === false) return false;
    return noDiff && context.untracked.names.length === 0;
  }
  if (target.mode === 'branch') return noDiff;
  return false;
}

function noChangesReviewResult(request, target, context) {
  const reviewName = request.reviewName;
  const review = {
    verdict: 'no-changes',
    summary: `No changes to review for ${target.label}; the diff is empty.`,
    findings: [],
    next_steps: [],
  };
  const companion = {
    resultKind: 'no-changes',
    rawOutput: 'not-applicable',
    targetScope: target.mode,
    targetLabel: target.label,
    parser: 'not-run',
    parseError: null,
    sensitiveContext: 'clear',
    model: null,
  };
  return {
    exitStatus: 0,
    rendered: renderReviewResult({
      reviewName,
      targetLabel: target.label,
      sessionId: null,
      review,
      parseError: null,
      warnings: [],
      companion,
    }),
    payload: {
      ok: true,
      kind: request.kind,
      degraded: false,
      answer: reviewAnswer(review),
      reviewName,
      targetLabel: target.label,
      sessionId: null,
      review,
      parseError: null,
      rawOutput: '',
      warnings: [],
      companion,
      context: {
        repoRoot: context.repoRoot,
        branch: context.branch,
        shortstat: context.shortstat,
        diffError: null,
        untracked: context.untracked.names,
      },
      claude: null,
    },
    sessionId: null,
    summary: review.summary,
  };
}

async function executeReviewRun(request) {
  ensureClaudeReady(request.cwd);
  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope,
  });
  const context = collectReviewContext(request.cwd, target);
  if (context.diffError) {
    return degradedReviewResult(request, target, context);
  }
  // Nothing to review: answer locally, never spending a Claude invocation.
  if (isEmptyReviewTarget(target, context)) {
    return noChangesReviewResult(request, target, context);
  }
  const schema = readJsonSchema(REVIEW_SCHEMA_PATH);
  const reviewName = request.reviewName;
  const sensitiveContext = blockSensitiveContext(
    reviewSensitiveSources(context, request.focusText),
    { strictSensitiveContext: request.strictSensitiveContext },
  );
  const prompt = buildReviewPrompt(context, reviewName, request.focusText);
  const claude = runClaudePrint(context.repoRoot, prompt, {
    model: request.model,
    effort: request.effort,
    timeoutMs: request.timeoutMs,
    maxBudgetUsd: request.maxBudgetUsd,
    jsonSchema: schema,
  });

  const parsed = normalizeReviewPayload(claude.resultText);
  const review =
    parsed.parsed ??
    fallbackReview(
      claude.status === 0
        ? `Claude output could not be parsed: ${parsed.parseError ?? claude.error ?? 'unknown parse error'}`
        : `Claude review failed: ${claude.error ?? claude.stderr.trim() ?? `exit ${claude.status}`}`,
    );
  const companion = reviewCompanionHealth({
    parsed,
    claude,
    target,
    sensitiveContext,
  });
  const warnings = warningForSensitiveContext(sensitiveContext);
  const degraded = !parsed.parsed || claude.status !== 0;

  return {
    // Any degraded review exits non-zero so it is never mistaken for a healthy
    // pass, matching the diff-error path. A meaningful Claude code (124 timeout,
    // 2 failure) is preserved; a parse fallback on a clean exit becomes 1.
    exitStatus: claude.status || (degraded ? 1 : 0),
    rendered: renderReviewResult({
      reviewName,
      targetLabel: target.label,
      sessionId: claude.sessionId,
      review,
      parseError: parsed.parseError,
      warnings,
      companion,
    }),
    payload: {
      ok: !degraded,
      kind: request.kind,
      degraded,
      answer: reviewAnswer(review),
      reviewName,
      targetLabel: target.label,
      sessionId: claude.sessionId,
      review,
      parseError: parsed.parseError,
      rawOutput: parsed.rawOutput,
      warnings,
      companion,
      context: {
        repoRoot: context.repoRoot,
        branch: context.branch,
        shortstat: context.shortstat,
        diffError: context.diffError,
        untracked: context.untracked.names,
      },
      claude: {
        status: claude.status,
        stderr: claude.stderr,
        totalCostUsd: claude.totalCostUsd,
        usage: claude.usage,
        modelUsage: claude.modelUsage,
        effectiveModels: claude.effectiveModels,
        eventCount: claude.eventCount,
        terminalReason: claude.terminalReason,
        resultTextSource: claude.resultTextSource,
      },
    },
    sessionId: claude.sessionId,
    summary: review.summary,
  };
}

function buildTaskPrompt(cwd, prompt, kind) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const context = collectTaskChangeContext(workspaceRoot);
  return {
    context,
    repoContext: context.repoContext,
    prompt: [
      'You are Claude Code running as a read-only companion for Codex.',
      'Do not edit files, run mutating commands, or ask for permission bypasses.',
      'Use read-only repository inspection tools when they help the task.',
      'Use Claude Code dynamic workflows for substantive tasks when helpful.',
      'Maintain an internal plan, progress ledger, and evidence ledger for this session.',
      'Use focused subagents when they improve the result: codebase-researcher, test-gap-reviewer, security-reviewer, architecture-critic, release-risk-reviewer, and log-diagnostician.',
      'Return one synthesized result for Codex. Do not include raw subagent transcripts.',
      '',
      '## Work Mode',
      ...workflowForTaskKind(kind).map((line) => `- ${line}`),
      '',
      '## Output Contract',
      '- Lead with the answer Codex needs next.',
      '- Cite files, commands, job ids, model names, or logs when they support a claim.',
      '- Keep uncertainty explicit. Do not turn a weak signal into a confirmed finding.',
      '- Include a short verification path when Codex should act on the result.',
      '',
      '## Repository Context',
      context.repoContext,
      '',
      '## Current Change Context',
      context.gitContext,
      '',
      '## Tracked Diff',
      buildDiffBlock(context),
      '',
      '## Untracked Files',
      context.untracked.rendered,
      '',
      '## Task',
      prompt,
    ].join('\n'),
  };
}

function collectTaskChangeContext(workspaceRoot) {
  try {
    const target = resolveReviewTarget(workspaceRoot, { scope: 'auto' });
    return collectReviewContext(workspaceRoot, target);
  } catch (error) {
    return {
      repoRoot: workspaceRoot,
      branch: null,
      target: { mode: 'none', label: 'no git repository' },
      status: 'Unknown.',
      shortstat: 'No git repository context.',
      diff: '',
      diffScanText: '',
      diffError: null,
      untracked: { names: [], entries: [], rendered: 'Not available.' },
      repoContext: collectRepoInstructions(workspaceRoot),
      gitContext: `Git context unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function taskSensitiveSources(task, request) {
  return [
    {
      sourceKind: 'task-prompt',
      text: request.prompt || DEFAULT_CONTINUE_PROMPT,
    },
    {
      sourceKind: 'repo-instructions',
      text: task.repoContext,
    },
    {
      sourceKind: 'git-context',
      text: task.context.gitContext,
    },
    {
      sourceKind: 'tracked-diff',
      path: task.context.target.label,
      text: task.context.diffScanText,
    },
    ...task.context.untracked.entries.map((entry) => ({
      sourceKind: 'untracked-file',
      path: entry.path,
      text: entry.content,
    })),
  ];
}

async function executeTaskRun(request) {
  ensureClaudeReady(request.cwd);
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  const task = buildTaskPrompt(
    workspaceRoot,
    request.prompt || DEFAULT_CONTINUE_PROMPT,
    request.kind,
  );
  const sensitiveContext = blockSensitiveContext(
    taskSensitiveSources(task, request),
    {
      strictSensitiveContext: request.strictSensitiveContext,
    },
  );
  const claude = runClaudePrint(workspaceRoot, task.prompt, {
    model: request.model,
    effort: request.effort,
    timeoutMs: request.timeoutMs,
    maxBudgetUsd: request.maxBudgetUsd,
    resumeSessionId: request.resumeSessionId,
  });
  const resultText = String(claude.resultText ?? '');
  const errorText = String(
    claude.error ?? claude.stderr?.trim() ?? `exit ${claude.status}`,
  );

  const degraded = claude.status !== 0 || !resultText.trim();
  const payload = {
    ok: !degraded,
    kind: request.kind,
    degraded,
    answer: resultText || errorText,
    rawOutput: resultText || errorText,
    sessionId: claude.sessionId,
    companion: {
      resultKind: 'task-output',
      rawOutput: 'preserved',
      sensitiveContext: sensitiveContext.length ? 'warned' : 'clear',
      model: effectiveModelName(claude),
      resultTextSource: claude.resultTextSource,
    },
    claude: {
      status: claude.status,
      error: claude.error ?? null,
      stderr: claude.stderr,
      totalCostUsd: claude.totalCostUsd,
      usage: claude.usage,
      modelUsage: claude.modelUsage,
      effectiveModels: claude.effectiveModels,
      eventCount: claude.eventCount,
      terminalReason: claude.terminalReason,
      resultTextSource: claude.resultTextSource,
    },
    warnings: warningForSensitiveContext(sensitiveContext),
  };

  return {
    // Mirror the review path: a degraded task (empty output) exits non-zero so
    // ok and the exit code agree; a real Claude failure code is preserved.
    exitStatus: claude.status || (degraded ? 1 : 0),
    rendered: renderTaskResult(payload),
    payload,
    sessionId: claude.sessionId,
    summary:
      resultText.split(/\r?\n/).find(Boolean) ??
      (claude.status === 0
        ? 'Claude task completed.'
        : `Claude task failed: ${errorText}`),
  };
}

async function runForegroundJob(job, request, runner, asJson) {
  appendLogLine(job.logFile, `Starting ${job.kind}.`);
  const running = {
    ...job,
    status: 'running',
    phase: 'running',
    pid: process.pid,
    startedAt: nowIso(),
    request,
  };
  upsertJob(job.workspaceRoot, running);
  writeJobFile(job.workspaceRoot, job.id, running);

  try {
    const execution = finalizeExecution(await runner(request));
    const status = execution.exitStatus === 0 ? 'completed' : 'failed';
    const resultFile = safePersistResult(
      job.workspaceRoot,
      job.id,
      execution.payload,
    );
    // Clear `request` from the terminal record: the runner consumed it in
    // memory above, and it holds the raw, unredacted prompt. `null` (not
    // omission) is required because upsertJob merges patches over the stored
    // job. The queued/running writes above keep `request` so the detached
    // worker can re-read it.
    const next = {
      ...running,
      status,
      phase: status,
      pid: null,
      sessionId: execution.sessionId ?? null,
      summary: execution.summary,
      resultFile,
      completedAt: nowIso(),
      request: null,
    };
    upsertJob(job.workspaceRoot, next);
    writeJobFile(job.workspaceRoot, job.id, next);
    appendLogLine(job.logFile, `${job.kind} ${status}.`);
    output(execution.payload, execution.rendered, asJson);
    if (execution.exitStatus !== 0) process.exitCode = execution.exitStatus;
    return execution;
  } catch (error) {
    const errorMessage = redactSecretLikeText(
      error instanceof Error ? error.message : String(error),
    );
    const resultFile = safePersistResult(
      job.workspaceRoot,
      job.id,
      exceptionFailurePayload(job, request, errorMessage),
    );
    const next = {
      ...running,
      status: 'failed',
      phase: 'failed',
      pid: null,
      errorMessage,
      resultFile,
      completedAt: nowIso(),
      request: null,
    };
    upsertJob(job.workspaceRoot, next);
    writeJobFile(job.workspaceRoot, job.id, next);
    appendLogLine(job.logFile, `Failed: ${errorMessage}`);
    throw error;
  }
}

function spawnDetachedWorker(cwd, jobId, logFile) {
  // Send only the detached worker's STDERR to the job log so an uncatchable
  // death (OOM, SIGKILL, a crash before the try/catch) leaves a trace that
  // `status` surfaces. The worker runs with --json, so its STDOUT is the full
  // companion payload (cost/usage JSON) that nobody reads here; routing that to
  // the log would bury the human-readable appendLogLine entries, so stdout is
  // discarded. The answer is preserved in the result file.
  let stdio = 'ignore';
  let logFd = null;
  if (logFile) {
    try {
      logFd = fs.openSync(logFile, 'a');
      stdio = ['ignore', 'ignore', logFd];
    } catch {
      stdio = 'ignore';
    }
  }
  try {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        'job-worker',
        '--cwd',
        cwd,
        '--job-id',
        jobId,
      ],
      {
        cwd,
        env: process.env,
        detached: true,
        stdio,
        windowsHide: true,
      },
    );
    child.unref();
    return child;
  } finally {
    if (logFd !== null) fs.closeSync(logFd);
  }
}

function enqueueBackgroundJob(cwd, job, request, asJson) {
  const queued = { ...job, status: 'queued', phase: 'queued', request };
  appendLogLine(job.logFile, `Queued ${job.kind}.`);
  writeJobFile(job.workspaceRoot, job.id, queued);
  upsertJob(job.workspaceRoot, queued);
  const child = spawnDetachedWorker(cwd, job.id, job.logFile);
  const next = { ...queued, pid: child.pid ?? null };
  writeJobFile(job.workspaceRoot, job.id, next);
  upsertJob(job.workspaceRoot, next);

  const title =
    job.jobClass === 'review'
      ? `Claude ${request.reviewName}`
      : 'Claude Code Task';
  const payload = {
    ok: true,
    kind: 'queued',
    jobId: job.id,
    workspaceRoot: job.workspaceRoot,
    title,
    status: 'queued',
    answer: `${title} started in the background as ${job.id}. Fetch it with action result and job_id ${job.id}.`,
    logFile: job.logFile,
  };
  output(payload, renderQueued(payload), asJson);
}

function parseCommonOptions(argv, extra = {}) {
  return parseArgs(argv, {
    valueOptions: [
      'base',
      'scope',
      'model',
      'effort',
      'timeout-ms',
      'max-budget-usd',
      'cwd',
      'job-id',
      'cost-preset',
    ],
    booleanOptions: [
      'json',
      'background',
      'all',
      'resume-last',
      'resume',
      'fresh',
      'strict-sensitive-context',
      // Deprecated no-op kept for backward compatibility: warn-and-continue is
      // the default, so this flag is accepted but does nothing. Declared here so
      // it parses as a recognized boolean rather than silently consuming the
      // following token.
      'allow-sensitive-context',
    ],
    aliasMap: { C: 'cwd', m: 'model', ...extra.aliasMap },
  });
}

async function handleSetup(argv) {
  const { options } = parseCommonOptions(argv);
  const cwd = resolveCwd(options);
  const report = buildSetupReport(cwd);
  const payload = {
    ok: report.ready,
    kind: 'setup',
    answer: report.ready
      ? 'Claude Code Companion is ready.'
      : `Claude Code Companion is not ready. ${report.nextSteps.join(' ')}`.trim(),
    ...report,
  };
  output(payload, renderSetup(report), Boolean(options.json));
  // Exit non-zero when not ready so a Codex agent that calls setup and checks
  // isError does not proceed to delegate against a broken environment.
  if (!report.ready) process.exitCode = 1;
}

async function handleReview(argv, reviewName) {
  const { options, positionals } = parseCommonOptions(argv);
  rejectWriteOptions(options);
  const preset = resolveCostPreset(options);
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const focusText = positionals.join(' ').trim();
  const scope = options.scope ?? 'auto';
  const targetSummary = options.base
    ? `against ${options.base}`
    : scope === 'repo' || scope === 'repository'
      ? 'repository review'
      : scope;
  const request = {
    kind: reviewName === 'Adversarial Review' ? 'adversarial-review' : 'review',
    jobClass: 'review',
    reviewName,
    cwd,
    base: options.base ?? null,
    scope,
    model: options.model ?? preset.model ?? null,
    effort: options.effort ?? preset.effort ?? null,
    timeoutMs: coerceTimeoutMs(options['timeout-ms']),
    maxBudgetUsd: options['max-budget-usd'] ?? null,
    strictSensitiveContext: Boolean(options['strict-sensitive-context']),
    focusText,
    summary: `${reviewName} ${targetSummary}`,
  };
  const job = buildJob(workspaceRoot, request);
  if (options.background) {
    enqueueBackgroundJob(cwd, job, request, Boolean(options.json));
    return;
  }
  await runForegroundJob(job, request, executeReviewRun, Boolean(options.json));
}

function readTaskPrompt(positionals) {
  return positionals.join(' ').trim() || readPipedStdin().trim();
}

async function handleTask(argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: [
      'model',
      'effort',
      'timeout-ms',
      'max-budget-usd',
      'cwd',
      'kind',
      'cost-preset',
    ],
    booleanOptions: [
      'json',
      'background',
      'resume-last',
      'resume',
      'fresh',
      'strict-sensitive-context',
      'allow-sensitive-context',
    ],
    aliasMap: { C: 'cwd', m: 'model' },
  });
  rejectWriteOptions(options);
  const preset = resolveCostPreset(options);
  if (options.kind !== undefined && !isValidTaskKind(options.kind)) {
    throw new Error(
      `Unknown task kind "${options.kind}". Use diagnose, plan, or research.`,
    );
  }
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const resumeLast = Boolean(options['resume-last'] || options.resume);
  if (resumeLast && options.fresh)
    throw new Error('Choose either --resume-last/--resume or --fresh.');
  const latest = resumeLast ? findLatestCompletedTask(workspaceRoot) : null;
  if (resumeLast && !latest)
    throw new Error(
      'No completed Claude task session found for this workspace.',
    );
  const prompt = readTaskPrompt(positionals);
  if (!prompt && !resumeLast)
    throw new Error('Provide a prompt or use --resume-last.');
  const request = {
    kind: resumeLast
      ? `${options.kind ?? 'task'}-resume`
      : (options.kind ?? 'task'),
    jobClass: 'task',
    cwd,
    prompt,
    resumeSessionId: latest?.sessionId ?? null,
    model: options.model ?? preset.model ?? null,
    effort: options.effort ?? preset.effort ?? null,
    timeoutMs: coerceTimeoutMs(options['timeout-ms']),
    maxBudgetUsd: options['max-budget-usd'] ?? null,
    strictSensitiveContext: Boolean(options['strict-sensitive-context']),
    summary:
      prompt.split(/\s+/).slice(0, 14).join(' ') || DEFAULT_CONTINUE_PROMPT,
  };
  const job = buildJob(workspaceRoot, request);
  if (options.background) {
    enqueueBackgroundJob(cwd, job, request, Boolean(options.json));
    return;
  }
  await runForegroundJob(job, request, executeTaskRun, Boolean(options.json));
}

function refreshRunningJobs(workspaceRoot) {
  for (const job of listJobs(workspaceRoot)) {
    if (!['queued', 'running'].includes(job.status)) continue;
    if (job.pid && isPidRunning(job.pid)) continue;
    const stored = readJobFile(workspaceRoot, job.id);
    if (stored && !['queued', 'running'].includes(stored.status)) {
      upsertJob(workspaceRoot, stored);
      continue;
    }
    // Clear `request` when marking a dead worker failed; otherwise the
    // unredacted prompt would persist in state.json indefinitely. `null` (not
    // omission) is required because upsertJob merges over the stored job.
    upsertJob(workspaceRoot, {
      ...job,
      status: 'failed',
      phase: 'failed',
      pid: null,
      errorMessage: 'Worker process is no longer running.',
      completedAt: nowIso(),
      request: null,
    });
  }
}

function resolveWorkspaceForReference(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  if (!reference) return workspaceRoot;
  if (findJob(workspaceRoot, reference)) return workspaceRoot;
  return findIndexedWorkspaceRoot(reference) ?? workspaceRoot;
}

// A reference was supplied but no such job exists in this workspace or the
// global index. Report it as an explicit error (exit 1) so a Codex agent does
// not mistake a typo'd or pruned id for an empty-but-successful result.
function outputJobNotFound(kind, reference, workspaceRoot, asJson) {
  const message = `No Claude Code Companion job matching "${reference}". It may have been pruned or the id is wrong; use action status to list jobs.`;
  output(
    { ok: false, kind, error: message, reference, workspaceRoot },
    `${message}\n`,
    asJson,
  );
  process.exitCode = 1;
}

// A queued/running job record carries the raw `request` (incl. the prompt) so
// the detached worker can re-read it. Never surface that on status/result
// output — callers only need the redacted summary and metadata.
function publicJob(job) {
  if (!job || typeof job !== 'object') return job;
  const { request: _request, ...rest } = job;
  return rest;
}

// Surface the human answer first; keep the raw log tail available separately.
function previewForJob(job, result) {
  const answerPreview =
    [result?.answer, result?.summary, job?.summary]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find(Boolean) ?? null;
  return { answerPreview, logTail: readLogPreview(job?.logFile) };
}

function handleStatus(argv) {
  const { options, positionals } = parseCommonOptions(argv);
  const cwd = resolveCwd(options);
  const reference = positionals[0] ?? '';
  const workspaceRoot = resolveWorkspaceForReference(cwd, reference);
  refreshRunningJobs(workspaceRoot);
  const jobs = reference
    ? [findJob(workspaceRoot, reference)].filter(Boolean)
    : sortJobsNewestFirst(listJobs(workspaceRoot)).slice(
        0,
        options.all ? 50 : 10,
      );
  if (reference && !jobs.length) {
    outputJobNotFound('status', reference, workspaceRoot, Boolean(options.json));
    return;
  }
  const now = Date.now();
  const report = {
    ok: true,
    kind: 'status',
    workspaceRoot,
    jobs: jobs.map((job) => {
      const terminal = !['queued', 'running'].includes(job.status);
      const result = terminal ? readResultFile(workspaceRoot, job.id) : null;
      const { answerPreview, logTail } = previewForJob(job, result);
      return {
        ...publicJob(job),
        ...jobLiveness(job, now),
        answerPreview,
        logTail,
        logPreview: logTail, // backward-compat alias
      };
    }),
  };
  output(report, renderStatus(report), Boolean(options.json));
}

function handleResult(argv) {
  const { options, positionals } = parseCommonOptions(argv);
  const cwd = resolveCwd(options);
  const reference = positionals[0] ?? '';
  const workspaceRoot = resolveWorkspaceForReference(cwd, reference);
  refreshRunningJobs(workspaceRoot);
  const job =
    (reference
      ? findJob(workspaceRoot, reference)
      : sortJobsNewestFirst(listJobs(workspaceRoot)).find(
          (entry) => !['queued', 'running'].includes(entry.status),
        )) ?? null;
  if (reference && !job) {
    outputJobNotFound('result', reference, workspaceRoot, Boolean(options.json));
    return;
  }
  // The job exists but has not produced a result yet: report an explicit
  // pending state (exit 0, poll-again) rather than an ambiguous ok:false/null.
  if (job && ['queued', 'running'].includes(job.status)) {
    output(
      {
        ok: false,
        kind: 'result',
        status: job.status,
        errorCode: 'not_ready',
        error: `Job ${job.id} is still ${job.status}; no result yet. Poll with action status, or fetch the result once it completes.`,
        workspaceRoot,
        job: publicJob(job),
        result: null,
        answer: null,
      },
      renderStoredResult({ job, result: null }),
      Boolean(options.json),
    );
    return;
  }
  const result = job ? readResultFile(workspaceRoot, job.id) : null;
  const { answerPreview } = previewForJob(job, result);
  const ok = Boolean(
    job && result && (result.ok ?? job.status === 'completed'),
  );
  output(
    {
      ok,
      kind: 'result',
      workspaceRoot,
      job: publicJob(job),
      result,
      answer: result?.answer ?? null,
      answerPreview,
    },
    renderStoredResult({ job, result }),
    Boolean(options.json),
  );
}

function handleCancel(argv) {
  const { options, positionals } = parseCommonOptions(argv);
  const cwd = resolveCwd(options);
  const reference = positionals[0] ?? '';
  const workspaceRoot = resolveWorkspaceForReference(cwd, reference);
  refreshRunningJobs(workspaceRoot);
  const job =
    (reference
      ? findJob(workspaceRoot, reference)
      : sortJobsNewestFirst(listJobs(workspaceRoot)).find((entry) =>
          ['queued', 'running'].includes(entry.status),
        )) ?? null;
  if (!job) {
    if (reference) {
      outputJobNotFound('cancel', reference, workspaceRoot, Boolean(options.json));
      return;
    }
    throw new Error('No cancellable Claude Code Companion job found.');
  }
  if (!['queued', 'running'].includes(job.status)) {
    output(
      {
        ok: true,
        kind: 'cancel',
        jobId: job.id,
        killed: false,
        status: job.status,
        note: `Job already ${job.status}; nothing to cancel.`,
      },
      `Job ${job.id} already ${job.status}; nothing to cancel.\n`,
      Boolean(options.json),
    );
    return;
  }
  const killed = terminateProcessTree(job.pid);
  const next = {
    ...job,
    status: 'cancelled',
    phase: 'cancelled',
    pid: null,
    cancelledAt: nowIso(),
    // The worker has been terminated, so the persisted request prompt is no
    // longer needed; clear it (null, not omit — upsertJob merges over the
    // stored job) so a cancelled job does not leave the raw prompt on disk.
    request: null,
  };
  appendLogLine(job.logFile, 'Cancelled by user.');
  writeJobFile(workspaceRoot, job.id, next);
  upsertJob(workspaceRoot, next);
  output(
    { ok: true, kind: 'cancel', jobId: job.id, killed, status: 'cancelled' },
    `Cancelled ${job.id}.\n`,
    Boolean(options.json),
  );
}

async function handleJobWorker(argv) {
  const { options } = parseCommonOptions(argv);
  if (!options['job-id']) throw new Error('Missing --job-id.');
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stored = readJobFile(workspaceRoot, options['job-id']);
  if (!stored?.request)
    throw new Error(`No stored request for ${options['job-id']}.`);
  const runner =
    stored.request.jobClass === 'review' ? executeReviewRun : executeTaskRun;
  await runForegroundJob(stored, stored.request, runner, true);
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }
  if (command === 'setup') await handleSetup(argv);
  else if (command === 'review') await handleReview(argv, 'Review');
  else if (command === 'adversarial-review')
    await handleReview(argv, 'Adversarial Review');
  else if (command === 'task') await handleTask(argv);
  else if (command === 'status') handleStatus(argv);
  else if (command === 'result') handleResult(argv);
  else if (command === 'cancel') handleCancel(argv);
  else if (command === 'job-worker') await handleJobWorker(argv);
  else throw new Error(`Unknown subcommand: ${command}`);
}

main().catch((error) => {
  const message = redactSecretLikeText(
    error instanceof Error ? error.message : String(error),
  );
  const exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  if (process.argv.includes('--json')) {
    output(
      {
        ok: false,
        error: message,
        code: error?.name ?? 'Error',
        sensitiveContext: Array.isArray(error?.findings)
          ? error.findings
          : undefined,
      },
      '',
      true,
    );
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exitCode = exitCode;
});
