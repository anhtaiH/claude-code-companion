import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

export function runSync(command, args = [], options = {}) {
  // Only pass a timeout when it is a usable positive number. A NaN or
  // non-positive value makes spawnSync throw a RangeError from Node internals,
  // which would surface to a Codex agent as an opaque crash unrelated to its
  // request. Callers validate user input up front; this is defense in depth
  // (e.g. a worker re-reading a persisted bad value).
  const timeout =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : undefined;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    timeout,
    stdio: options.stdio ?? 'pipe',
  });

  return {
    command: [command, ...args].join(' '),
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
    signal: result.signal ?? null,
    ok: !result.error && (result.status ?? 0) === 0,
  };
}

export function binaryAvailable(command, args = ['--version'], options = {}) {
  const result = runSync(command, args, options);
  return {
    available: result.ok,
    detail: result.ok
      ? (result.stdout || result.stderr).trim()
      : result.error?.message ||
        result.stderr.trim() ||
        `${command} unavailable`,
    status: result.status,
  };
}

export function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Spawn-free last-modified time of a file in ms, or null if absent/unreadable.
// Used as a cheap, portable "last output" proxy for job liveness.
export function statMtimeMs(filePath) {
  if (!filePath) return null;
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

const STALE_AFTER_MS = 5 * 60 * 1000;
const QUIET_AFTER_MS = 30 * 1000;
// How long a queued job may legitimately sit without a recorded pid: the
// enqueue path writes the job, spawns the detached worker, then records the
// worker pid. Within this window a missing pid means "spawn in progress", not
// "worker died".
export const SPAWN_GRACE_MS = 15 * 1000;

export function isWithinSpawnGrace(job, now = Date.now()) {
  const referenceMs =
    Date.parse(job?.updatedAt ?? job?.createdAt ?? '') || 0;
  return now - referenceMs < SPAWN_GRACE_MS;
}

// Cheap, portable liveness signal so a caller can tell working-quietly from
// hung from stale without spawning anything. "Last output" is the job log's
// mtime; CPU/RSS/child-count are deliberately omitted (platform-specific).
export function jobLiveness(job, now = Date.now()) {
  const active = ['queued', 'running'].includes(job.status);
  const startMs = Date.parse(job.startedAt ?? job.createdAt ?? '') || null;
  const endMs = active ? now : Date.parse(job.completedAt ?? '') || now;
  const elapsedMs = startMs != null ? Math.max(0, endMs - startMs) : null;
  const mtime = statMtimeMs(job.logFile);
  const lastOutputAt = mtime ? new Date(mtime).toISOString() : null;
  const lastOutputAgeMs = mtime != null ? Math.max(0, now - mtime) : null;
  const pidAlive = active ? isPidRunning(job.pid) : false;
  let liveness;
  if (!active) liveness = job.status;
  else if (!job.pid && isWithinSpawnGrace(job, now)) liveness = 'starting';
  else if (!pidAlive) liveness = 'stale';
  else if (lastOutputAgeMs != null && lastOutputAgeMs > STALE_AFTER_MS)
    liveness = 'possibly-blocked';
  else if (lastOutputAgeMs != null && lastOutputAgeMs > QUIET_AFTER_MS)
    liveness = 'quiet';
  else liveness = 'alive';
  return { pidAlive, elapsedMs, lastOutputAt, lastOutputAgeMs, liveness };
}

export function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function signalProcessTree(pid, signal) {
  let signalled = false;
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      signalled = true;
    } catch {
      // No process group, or already gone. Fall back to the direct pid below.
    }
  }
  try {
    process.kill(pid, signal);
    signalled = true;
  } catch {
    // Already gone or inaccessible.
  }
  return signalled;
}

// SIGTERM the worker's process group, wait briefly for it to exit, then
// escalate to SIGKILL so a wedged Claude child cannot keep burning budget after
// a cancel. The returned `killed` reflects observed liveness, not merely that a
// signal was delivered, so the reported status is honest. Note the worker pid
// is a proxy: a detached grandchild that escaped the group may still outlive it.
export function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!isPidRunning(pid)) return true;
  signalProcessTree(pid, 'SIGTERM');
  for (let waited = 0; waited < 600 && isPidRunning(pid); waited += 100) {
    sleepSync(100);
  }
  if (!isPidRunning(pid)) return true;
  signalProcessTree(pid, 'SIGKILL');
  sleepSync(100);
  return !isPidRunning(pid);
}

export function nowIso() {
  return new Date().toISOString();
}
