import { spawnSync } from 'node:child_process';
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
