import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { listJobs, upsertJob } from '../scripts/lib/state.mjs';
import {
  buildEnv,
  COMPANION,
  initGitRepo,
  installFakeClaude,
  makeTempDir,
  run,
} from './helpers.mjs';

function tempRepo() {
  const repo = makeTempDir();
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(
    path.join(repo, 'src', 'app.js'),
    'export const value = 1;\n',
  );
  run('git', ['add', 'src/app.js'], { cwd: repo });
  run('git', ['commit', '-m', 'add app'], { cwd: repo });
  fs.writeFileSync(
    path.join(repo, 'src', 'app.js'),
    'export const value = items[0].id;\n',
  );
  return repo;
}

test('setup reports ready with fake Claude installed and authenticated', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'setup', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.match(payload.claude.detail, /Claude Code/);
  assert.equal(payload.auth.loggedIn, true);
  assert.equal(payload.auth.email, undefined);
  assert.equal(payload.auth.orgId, undefined);
});

test('setup reports missing Claude without using real PATH', () => {
  const binDir = makeTempDir();
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  const repo = tempRepo();
  const env = buildEnv(binDir, { PATH: binDir });

  const result = run(
    process.execPath,
    [COMPANION, 'setup', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, false);
  assert.equal(payload.claude.available, false);
});

test('setup handles unauthenticated and invalid auth status', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();

  const unauth = run(
    process.execPath,
    [COMPANION, 'setup', '--cwd', repo, '--json'],
    {
      env: buildEnv(binDir, { FAKE_CLAUDE_MODE: 'unauth' }),
    },
  );
  assert.equal(JSON.parse(unauth.stdout).ready, false);

  const invalid = run(
    process.execPath,
    [COMPANION, 'setup', '--cwd', repo, '--json'],
    {
      env: buildEnv(binDir, { FAKE_CLAUDE_MODE: 'bad-auth-json' }),
    },
  );
  assert.equal(
    JSON.parse(invalid.stdout).auth.detail,
    'claude auth status returned invalid JSON',
  );
});

test('review returns structured findings from fake Claude', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review.verdict, 'changes-needed');
  assert.equal(payload.review.findings[0].file, 'src/app.js');
  assert.equal(payload.sessionId, 'fake-session-1');
});

test('malformed review output becomes needs-attention', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'malformed' });

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review.verdict, 'needs-attention');
  assert.match(payload.review.summary, /could not be parsed/i);
});

test('secret-like output is not persisted', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'secret' });

  const result = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, 'diagnose', '--json'],
    { env },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /secret-like text/i);
});

test('read-only v1 rejects write flags', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--write', 'fix it'],
    { env },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /read-only/i);
});

test('task resume-last uses the latest completed task session', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const stateDir = makeTempDir();
  const env = buildEnv(binDir, {
    CLAUDE_CODE_COMPANION_STATE_DIR: stateDir,
    FAKE_SESSION_ID: 'fake-session-original',
  });

  const first = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, 'diagnose', '--json'],
    { env },
  );
  assert.equal(first.status, 0, first.stderr);

  const second = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--resume-last', '--json'],
    {
      env: { ...env, FAKE_SESSION_ID: 'fake-session-resume-output' },
    },
  );

  assert.equal(second.status, 0, second.stderr);
  const payload = JSON.parse(second.stdout);
  assert.match(payload.rawOutput, /RESUMED fake-session-original/);
});

test('background task can be listed and cancelled', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'slow' });

  const started = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--background', 'slow job', '--json'],
    {
      env,
    },
  );
  assert.equal(started.status, 0, started.stderr);
  const jobId = JSON.parse(started.stdout).jobId;

  const status = run(
    process.execPath,
    [COMPANION, 'status', '--cwd', repo, jobId, '--json'],
    { env },
  );
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).jobs[0].id, jobId);

  const cancel = run(
    process.execPath,
    [COMPANION, 'cancel', '--cwd', repo, jobId, '--json'],
    { env },
  );
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.equal(JSON.parse(cancel.stdout).status, 'cancelled');
});

test('job state keeps only the latest fifty jobs', () => {
  const workspace = makeTempDir();
  const stateDir = makeTempDir();
  const previous = process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
  process.env.CLAUDE_CODE_COMPANION_STATE_DIR = stateDir;
  try {
    for (let index = 0; index < 55; index += 1) {
      upsertJob(workspace, {
        id: `job-${index}`,
        status: 'completed',
        updatedAt: new Date(Date.now() + index).toISOString(),
      });
    }
    assert.equal(listJobs(workspace).length, 50);
  } finally {
    if (previous === undefined)
      delete process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
    else process.env.CLAUDE_CODE_COMPANION_STATE_DIR = previous;
  }
});
