import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nowIso } from './process.mjs';

const STATE_VERSION = 1;
const MAX_JOBS = 50;

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function slugFor(value) {
  return (
    path
      .basename(value)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace'
  );
}

function defaultState() {
  return {
    version: STATE_VERSION,
    jobs: [],
  };
}

export function resolveStateRoot() {
  if (process.env.CLAUDE_CODE_COMPANION_STATE_DIR) {
    return path.resolve(process.env.CLAUDE_CODE_COMPANION_STATE_DIR);
  }
  if (process.env.CODEX_PLUGIN_DATA) {
    return path.join(
      process.env.CODEX_PLUGIN_DATA,
      'claude-code-companion',
      'state',
    );
  }
  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, 'claude-code-companion');
  }
  return path.join(os.homedir(), '.local', 'state', 'claude-code-companion');
}

export function resolveStateDir(workspaceRoot) {
  const canonical = canonicalPath(workspaceRoot);
  const digest = createHash('sha256')
    .update(canonical)
    .digest('hex')
    .slice(0, 16);
  return path.join(resolveStateRoot(), `${slugFor(canonical)}-${digest}`);
}

export function resolveStateFile(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), 'state.json');
}

export function resolveJobsDir(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), 'jobs');
}

export function ensureStateDir(workspaceRoot) {
  fs.mkdirSync(resolveJobsDir(workspaceRoot), { recursive: true });
}

export function resolveJobFile(workspaceRoot, jobId) {
  return path.join(resolveJobsDir(workspaceRoot), `${jobId}.json`);
}

export function resolveJobLogFile(workspaceRoot, jobId) {
  return path.join(resolveJobsDir(workspaceRoot), `${jobId}.log`);
}

export function resolveJobResultFile(workspaceRoot, jobId) {
  return path.join(resolveJobsDir(workspaceRoot), `${jobId}.result.json`);
}

export function loadState(workspaceRoot) {
  const filePath = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(filePath)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      ...defaultState(),
      ...parsed,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((left, right) =>
      String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')),
    )
    .slice(0, MAX_JOBS);
}

export function saveState(workspaceRoot, state) {
  ensureStateDir(workspaceRoot);
  const next = {
    version: STATE_VERSION,
    jobs: pruneJobs(state.jobs ?? []),
  };
  fs.writeFileSync(
    resolveStateFile(workspaceRoot),
    `${JSON.stringify(next, null, 2)}\n`,
  );
  return next;
}

export function updateState(workspaceRoot, mutate) {
  const state = loadState(workspaceRoot);
  mutate(state);
  return saveState(workspaceRoot, state);
}

export function generateJobId(prefix = 'job') {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${suffix}`;
}

export function upsertJob(workspaceRoot, patch) {
  return updateState(workspaceRoot, (state) => {
    const at = nowIso();
    const index = state.jobs.findIndex((job) => job.id === patch.id);
    if (index === -1) {
      state.jobs.unshift({
        createdAt: at,
        updatedAt: at,
        ...patch,
      });
      return;
    }
    state.jobs[index] = {
      ...state.jobs[index],
      ...patch,
      updatedAt: at,
    };
  });
}

export function listJobs(workspaceRoot) {
  return loadState(workspaceRoot).jobs;
}

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((left, right) =>
    String(right.updatedAt ?? right.createdAt ?? '').localeCompare(
      String(left.updatedAt ?? left.createdAt ?? ''),
    ),
  );
}

export function writeJobFile(workspaceRoot, jobId, payload) {
  ensureStateDir(workspaceRoot);
  const filePath = resolveJobFile(workspaceRoot, jobId);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

export function readJobFile(workspaceRoot, jobId) {
  const filePath = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeResultFile(workspaceRoot, jobId, payload) {
  ensureStateDir(workspaceRoot);
  const filePath = resolveJobResultFile(workspaceRoot, jobId);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

export function readResultFile(workspaceRoot, jobId) {
  const filePath = resolveJobResultFile(workspaceRoot, jobId);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function appendLogLine(filePath, line) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${nowIso()} ${line}\n`);
}

export function readLogPreview(filePath, limit = 20) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return lines.slice(Math.max(0, lines.length - limit));
}

export function findJob(workspaceRoot, reference = '') {
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  if (!reference) {
    return jobs[0] ?? null;
  }
  return (
    jobs.find((job) => job.id === reference || job.id.startsWith(reference)) ??
    null
  );
}

export function findLatestCompletedTask(workspaceRoot) {
  return (
    sortJobsNewestFirst(listJobs(workspaceRoot)).find(
      (job) =>
        job.jobClass === 'task' &&
        job.sessionId &&
        !['queued', 'running'].includes(job.status),
    ) ?? null
  );
}
