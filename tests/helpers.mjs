import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'claude-code-companion');
export const COMPANION = path.join(PLUGIN_ROOT, 'scripts', 'claude-companion.mjs');
export const MCP_SERVER = path.join(PLUGIN_ROOT, 'scripts', 'mcp-server.mjs');

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-companion-'));
}

export function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout,
  });
}

export function initGitRepo(repo) {
  run('git', ['init', '-b', 'main'], { cwd: repo });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  run('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), '# Test repo\n');
  run('git', ['add', 'README.md'], { cwd: repo });
  run('git', ['commit', '-m', 'init'], { cwd: repo });
}

export function buildEnv(binDir, extra = {}) {
  return {
    ...process.env,
    ...extra,
    PATH: extra.PATH ?? `${binDir}${path.delimiter}${process.env.PATH}`,
    CLAUDE_CODE_COMPANION_STATE_DIR:
      extra.CLAUDE_CODE_COMPANION_STATE_DIR ?? makeTempDir(),
  };
}

export function installFakeClaude(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  try {
    fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  } catch {
    // Symlink may already exist in reused temp dirs.
  }
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
if (args.includes('--version')) {
  console.log('2.1.158 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (mode === 'unauth') {
    console.log(JSON.stringify({ loggedIn: false }));
    process.exit(0);
  }
  if (mode === 'bad-auth-json') {
    console.log('not json');
    process.exit(0);
  }
  console.log(JSON.stringify({
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    email: 'private@example.com',
    orgId: 'secret-org',
    subscriptionType: 'max'
  }));
  process.exit(0);
}
if (!args.includes('-p')) {
  console.error('unexpected fake claude args: ' + args.join(' '));
  process.exit(1);
}
if (process.env.FAKE_CLAUDE_ARGS_FILE) {
  fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(args));
}
const input = fs.readFileSync(0, 'utf8');
if (process.env.FAKE_CLAUDE_STDIN_FILE) {
  fs.writeFileSync(process.env.FAKE_CLAUDE_STDIN_FILE, input);
}
if (mode === 'slow') {
  setTimeout(() => {}, 30000);
  return;
}
if (mode === 'malformed') {
  console.log(JSON.stringify({ type: 'result', result: 'not-json', session_id: 'fake-session-malformed' }));
  process.exit(0);
}
if (mode === 'secret') {
  console.log(JSON.stringify({ type: 'result', result: 'token=sk-abcdefghijklmnopqrstuvwxyz', session_id: 'fake-session-secret' }));
  process.exit(0);
}
if (mode === 'nonzero') {
  console.error('simulated claude failure');
  process.exit(2);
}
const resumeIndex = args.indexOf('--resume');
const resumed = resumeIndex === -1 ? null : args[resumeIndex + 1];
const sessionId = process.env.FAKE_SESSION_ID || (resumed ? 'fake-session-resumed' : 'fake-session-1');
const isReview = input.includes('Return strict JSON only') || input.includes('## Diff');
const review = {
  verdict: 'changes-needed',
  summary: 'Fake review found one issue.',
  findings: [{
    severity: 'high',
    title: 'Missing guard',
    body: 'The changed path does not handle the empty case.',
    file: 'src/app.js',
    line_start: 1,
    line_end: 1,
    recommendation: 'Add an explicit guard.'
  }],
  next_steps: ['Add the guard and rerun tests.']
};
const result = isReview ? JSON.stringify(review) : (resumed ? 'RESUMED ' + resumed : 'Handled task');
console.log(JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 1,
  result,
  session_id: sessionId,
  total_cost_usd: 0.001,
  usage: { input_tokens: 1, output_tokens: 1 },
  modelUsage: { fake: { inputTokens: 1, outputTokens: 1, costUSD: 0.001 } },
  terminal_reason: 'completed'
}));
`;
  const claudePath = path.join(binDir, 'claude');
  fs.writeFileSync(claudePath, script);
  fs.chmodSync(claudePath, 0o755);
}
