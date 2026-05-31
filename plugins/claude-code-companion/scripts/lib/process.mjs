import { spawnSync } from 'node:child_process';
import process from 'node:process';

export function runSync(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    timeout: options.timeoutMs,
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

export function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  let killed = false;
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGTERM');
      killed = true;
    } catch {
      // Fall back to killing the direct child below.
    }
  }
  try {
    process.kill(pid, 'SIGTERM');
    killed = true;
  } catch {
    // Already gone or inaccessible.
  }
  return killed;
}

export function nowIso() {
  return new Date().toISOString();
}
