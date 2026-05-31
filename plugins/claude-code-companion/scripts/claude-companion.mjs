#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import {
  getClaudeAuthStatus,
  getClaudeAvailability,
  getClaudeDefaults,
  hasSecretLikeText,
  normalizeReviewPayload,
  readJsonSchema,
  runClaudePrint,
} from './lib/claude.mjs';
import {
  collectRepoInstructions,
  collectReviewContext,
  resolveReviewTarget,
  resolveWorkspaceRoot,
} from './lib/git.mjs';
import {
  binaryAvailable,
  isPidRunning,
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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const REVIEW_SCHEMA_PATH = path.join(
  ROOT_DIR,
  'schemas',
  'review-output.schema.json',
);
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_CONTINUE_PROMPT =
  'Continue from the current Claude Code companion session. Stay read-only and return the next useful diagnosis or plan.';

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/claude-companion.mjs setup [--cwd <path>] [--json]',
      '  node scripts/claude-companion.mjs review [--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort <level>] [--timeout-ms <ms>] [--json]',
      '  node scripts/claude-companion.mjs adversarial-review [same flags as review] [focus text]',
      '  node scripts/claude-companion.mjs task [--kind <kind>] [--background] [--resume-last|--resume] [--fresh] [--model <model>] [--effort <level>] [prompt]',
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

function buildSetupReport(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  ensureStateDir(workspaceRoot);
  const node = binaryAvailable('node', ['--version'], { cwd });
  const claude = getClaudeAvailability(cwd);
  const auth = claude.available
    ? getClaudeAuthStatus(cwd)
    : { loggedIn: false, detail: 'Claude Code is not installed.' };
  const nextSteps = [];
  if (!claude.available) nextSteps.push('Install Claude Code and rerun setup.');
  if (claude.available && !auth.loggedIn)
    nextSteps.push('Run `claude auth login`.');

  return {
    ready: node.available && claude.available && auth.loggedIn,
    node,
    claude,
    auth,
    workspaceRoot,
    stateDir: resolveStateDir(workspaceRoot),
    defaults: getClaudeDefaults(),
    nextSteps,
  };
}

function buildJob(workspaceRoot, request) {
  const id = generateJobId(request.jobClass === 'review' ? 'review' : 'task');
  const logFile = resolveJobLogFile(workspaceRoot, id);
  const resultFile = resolveJobResultFile(workspaceRoot, id);
  return {
    id,
    workspaceRoot,
    kind: request.kind,
    jobClass: request.jobClass,
    status: 'queued',
    phase: 'queued',
    pid: null,
    sessionId: null,
    model: request.model ?? null,
    scope: request.scope ?? request.base ?? null,
    summary: request.summary,
    logFile,
    resultFile,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function safePersistResult(workspaceRoot, jobId, payload) {
  const serialized = JSON.stringify(payload);
  if (hasSecretLikeText(serialized)) {
    throw new Error(
      'Claude output contained secret-like text; refusing to persist it.',
    );
  }
  return writeResultFile(workspaceRoot, jobId, payload);
}

function buildDiffBlock(context) {
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

function fallbackReview(summary) {
  return {
    verdict: 'needs-attention',
    summary,
    findings: [],
    next_steps: ['Rerun the Claude review or inspect the companion logs.'],
  };
}

async function executeReviewRun(request) {
  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope,
  });
  const context = collectReviewContext(request.cwd, target);
  const schema = readJsonSchema(REVIEW_SCHEMA_PATH);
  const reviewName = request.reviewName;
  const prompt = buildReviewPrompt(context, reviewName, request.focusText);
  const claude = runClaudePrint(context.repoRoot, prompt, {
    model: request.model,
    effort: request.effort,
    timeoutMs: request.timeoutMs,
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

  return {
    exitStatus: claude.status,
    rendered: renderReviewResult({
      reviewName,
      targetLabel: target.label,
      sessionId: claude.sessionId,
      review,
    }),
    payload: {
      reviewName,
      targetLabel: target.label,
      sessionId: claude.sessionId,
      review,
      parseError: parsed.parseError,
      context: {
        repoRoot: context.repoRoot,
        branch: context.branch,
        shortstat: context.shortstat,
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
      },
    },
    sessionId: claude.sessionId,
    summary: review.summary,
  };
}

function buildTaskPrompt(cwd, prompt) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const repoContext = collectRepoInstructions(workspaceRoot);
  return [
    'You are Claude Code running as a read-only companion for Codex.',
    'Do not edit files, run mutating commands, or ask for permission bypasses.',
    'Use read-only repository inspection tools when they help the task.',
    'Use Claude Code dynamic workflows for substantive tasks when helpful.',
    'Maintain an internal plan, progress ledger, and evidence ledger for this session.',
    'Use focused subagents when they improve the result: codebase-researcher, test-gap-reviewer, security-reviewer, architecture-critic, release-risk-reviewer, and log-diagnostician.',
    'Return one synthesized result for Codex. Do not include raw subagent transcripts.',
    '',
    '## Repository Context',
    repoContext,
    '',
    '## Task',
    prompt,
  ].join('\n');
}

async function executeTaskRun(request) {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  const prompt = buildTaskPrompt(
    workspaceRoot,
    request.prompt || DEFAULT_CONTINUE_PROMPT,
  );
  const claude = runClaudePrint(workspaceRoot, prompt, {
    model: request.model,
    effort: request.effort,
    timeoutMs: request.timeoutMs,
    resumeSessionId: request.resumeSessionId,
  });

  const payload = {
    rawOutput: claude.resultText,
    sessionId: claude.sessionId,
    claude: {
      status: claude.status,
      stderr: claude.stderr,
      totalCostUsd: claude.totalCostUsd,
      usage: claude.usage,
      modelUsage: claude.modelUsage,
      effectiveModels: claude.effectiveModels,
      eventCount: claude.eventCount,
      terminalReason: claude.terminalReason,
    },
  };

  return {
    exitStatus: claude.status,
    rendered: renderTaskResult(payload),
    payload,
    sessionId: claude.sessionId,
    summary:
      claude.resultText.split(/\r?\n/).find(Boolean) ??
      'Claude task completed.',
  };
}

async function runForegroundJob(job, request, runner, asJson) {
  appendLogLine(job.logFile, `Starting ${job.kind}.`);
  const running = {
    ...job,
    status: 'running',
    phase: 'running',
    pid: process.pid,
    request,
  };
  upsertJob(job.workspaceRoot, running);
  writeJobFile(job.workspaceRoot, job.id, running);

  try {
    const execution = await runner(request);
    const status = execution.exitStatus === 0 ? 'completed' : 'failed';
    const resultFile = safePersistResult(
      job.workspaceRoot,
      job.id,
      execution.payload,
    );
    const next = {
      ...running,
      status,
      phase: status,
      pid: null,
      sessionId: execution.sessionId ?? null,
      summary: execution.summary,
      resultFile,
      completedAt: nowIso(),
    };
    upsertJob(job.workspaceRoot, next);
    writeJobFile(job.workspaceRoot, job.id, next);
    appendLogLine(job.logFile, `${job.kind} ${status}.`);
    output(execution.payload, execution.rendered, asJson);
    if (execution.exitStatus !== 0) process.exitCode = execution.exitStatus;
    return execution;
  } catch (error) {
    const next = {
      ...running,
      status: 'failed',
      phase: 'failed',
      pid: null,
      errorMessage: error.message,
      completedAt: nowIso(),
    };
    upsertJob(job.workspaceRoot, next);
    writeJobFile(job.workspaceRoot, job.id, next);
    appendLogLine(job.logFile, `Failed: ${error.message}`);
    throw error;
  }
}

function spawnDetachedWorker(cwd, jobId) {
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
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  child.unref();
  return child;
}

function enqueueBackgroundJob(cwd, job, request, asJson) {
  const queued = { ...job, status: 'queued', phase: 'queued', request };
  appendLogLine(job.logFile, `Queued ${job.kind}.`);
  writeJobFile(job.workspaceRoot, job.id, queued);
  upsertJob(job.workspaceRoot, queued);
  const child = spawnDetachedWorker(cwd, job.id);
  const next = { ...queued, pid: child.pid ?? null };
  writeJobFile(job.workspaceRoot, job.id, next);
  upsertJob(job.workspaceRoot, next);

  const payload = {
    jobId: job.id,
    title:
      job.jobClass === 'review'
        ? `Claude ${request.reviewName}`
        : 'Claude Code Task',
    status: 'queued',
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
      'cwd',
      'job-id',
    ],
    booleanOptions: [
      'json',
      'background',
      'wait',
      'all',
      'resume-last',
      'resume',
      'fresh',
    ],
    aliasMap: { C: 'cwd', m: 'model', ...extra.aliasMap },
  });
}

async function handleSetup(argv) {
  const { options } = parseCommonOptions(argv);
  const cwd = resolveCwd(options);
  const report = buildSetupReport(cwd);
  output(report, renderSetup(report), Boolean(options.json));
}

async function handleReview(argv, reviewName) {
  const { options, positionals } = parseCommonOptions(argv);
  rejectWriteOptions(options);
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const focusText = positionals.join(' ').trim();
  const request = {
    kind: reviewName === 'Adversarial Review' ? 'adversarial-review' : 'review',
    jobClass: 'review',
    reviewName,
    cwd,
    base: options.base ?? null,
    scope: options.scope ?? 'auto',
    model: options.model ?? null,
    effort: options.effort ?? null,
    timeoutMs: Number(options['timeout-ms'] ?? DEFAULT_TIMEOUT_MS),
    focusText,
    summary: `${reviewName} ${options.base ? `against ${options.base}` : (options.scope ?? 'working tree')}`,
  };
  const job = buildJob(workspaceRoot, request);
  if (options.background) {
    enqueueBackgroundJob(cwd, job, request, Boolean(options.json));
    return;
  }
  await runForegroundJob(job, request, executeReviewRun, Boolean(options.json));
}

function readTaskPrompt(cwd, options, positionals) {
  if (options['prompt-file']) {
    return fs.readFileSync(path.resolve(cwd, options['prompt-file']), 'utf8');
  }
  return positionals.join(' ').trim() || readPipedStdin().trim();
}

async function handleTask(argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: [
      'model',
      'effort',
      'timeout-ms',
      'cwd',
      'prompt-file',
      'kind',
    ],
    booleanOptions: ['json', 'background', 'resume-last', 'resume', 'fresh'],
    aliasMap: { C: 'cwd', m: 'model' },
  });
  rejectWriteOptions(options);
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
  const prompt = readTaskPrompt(cwd, options, positionals);
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
    model: options.model ?? null,
    effort: options.effort ?? null,
    timeoutMs: Number(options['timeout-ms'] ?? DEFAULT_TIMEOUT_MS),
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
    upsertJob(workspaceRoot, {
      ...job,
      status: 'failed',
      phase: 'failed',
      pid: null,
      errorMessage: 'Worker process is no longer running.',
      completedAt: nowIso(),
    });
  }
}

function handleStatus(argv) {
  const { options, positionals } = parseCommonOptions(argv);
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  refreshRunningJobs(workspaceRoot);
  const reference = positionals[0] ?? '';
  const jobs = reference
    ? [findJob(workspaceRoot, reference)].filter(Boolean)
    : sortJobsNewestFirst(listJobs(workspaceRoot)).slice(
        0,
        options.all ? 50 : 10,
      );
  const report = {
    workspaceRoot,
    jobs: jobs.map((job) => ({
      ...job,
      logPreview: readLogPreview(job.logFile),
    })),
  };
  output(report, renderStatus(report), Boolean(options.json));
}

function handleResult(argv) {
  const { options, positionals } = parseCommonOptions(argv);
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reference = positionals[0] ?? '';
  const job =
    (reference
      ? findJob(workspaceRoot, reference)
      : sortJobsNewestFirst(listJobs(workspaceRoot)).find(
          (entry) => !['queued', 'running'].includes(entry.status),
        )) ?? null;
  const result = job ? readResultFile(workspaceRoot, job.id) : null;
  output(
    { workspaceRoot, job, result },
    renderStoredResult({ job, result }),
    Boolean(options.json),
  );
}

function handleCancel(argv) {
  const { options, positionals } = parseCommonOptions(argv);
  const cwd = resolveCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reference = positionals[0] ?? '';
  const job =
    (reference
      ? findJob(workspaceRoot, reference)
      : sortJobsNewestFirst(listJobs(workspaceRoot)).find((entry) =>
          ['queued', 'running'].includes(entry.status),
        )) ?? null;
  if (!job) throw new Error('No cancellable Claude Code Companion job found.');
  const killed = terminateProcessTree(job.pid);
  const next = {
    ...job,
    status: 'cancelled',
    phase: 'cancelled',
    pid: null,
    cancelledAt: nowIso(),
  };
  appendLogLine(job.logFile, 'Cancelled by user.');
  writeJobFile(workspaceRoot, job.id, next);
  upsertJob(workspaceRoot, next);
  output(
    { jobId: job.id, killed, status: 'cancelled' },
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
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
