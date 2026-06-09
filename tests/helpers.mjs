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
  console.log(process.env.FAKE_CLAUDE_VERSION || '2.1.158 (Claude Code)');
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
if (process.env.FAKE_CLAUDE_PID_FILE) {
  fs.writeFileSync(process.env.FAKE_CLAUDE_PID_FILE, String(process.pid));
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
  console.log(JSON.stringify({ type: 'result', result: 'token' + '=' + 'sk-' + 'A'.repeat(40), session_id: 'fake-session-secret' }));
  process.exit(0);
}
if (mode === 'nonzero') {
  console.error('simulated claude failure');
  process.exit(2);
}
if (mode === 'nonzero-quiet') {
  process.exit(3);
}
if (mode === 'structured-output') {
  // Mirrors Claude CLI >= 2.1.x --json-schema behavior: the validated object
  // arrives in structured_output and result carries no useful text.
  console.log(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1,
    result: '',
    structured_output: {
      verdict: 'approve-with-nits',
      summary: 'Structured output carried the review.',
      findings: [],
      next_steps: []
    },
    session_id: 'fake-session-structured',
    total_cost_usd: 0.001,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: { fake: { inputTokens: 1, outputTokens: 1, costUSD: 0.001 } },
    terminal_reason: 'completed'
  }));
  process.exit(0);
}
if (mode === 'stream-json') {
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'subagent progress' }]
    },
    subagent_type: 'codebase-researcher'
  }));
  console.log(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1,
    result: 'Handled stream result',
    session_id: 'fake-session-stream',
    total_cost_usd: 0.001,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: { fake: { inputTokens: 1, outputTokens: 1, costUSD: 0.001 } },
    terminal_reason: 'completed'
  }));
  process.exit(0);
}
if (mode === 'assistant-final') {
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify({
        verdict: 'approve',
        summary: 'Assistant transcript carried the final review.',
        findings: [],
        next_steps: []
      }) }]
    }
  }));
  console.log(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1,
    result: 'Release-risk specialist completed; waiting for final synthesis.',
    session_id: 'fake-session-assistant-final',
    total_cost_usd: 0.001,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: { fake: { inputTokens: 1, outputTokens: 1, costUSD: 0.001 } },
    terminal_reason: 'completed'
  }));
  process.exit(0);
}
if (mode === 'assistant-chatter') {
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'I will inspect the repo first.' }]
    }
  }));
  console.log(JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify({
        verdict: 'approve',
        summary: 'Final assistant message carried the review.',
        findings: [],
        next_steps: []
      }) }]
    }
  }));
  console.log(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1,
    result: '…',
    session_id: 'fake-session-assistant-chatter',
    total_cost_usd: 0.001,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: { fake: { inputTokens: 1, outputTokens: 1, costUSD: 0.001 } },
    terminal_reason: 'completed'
  }));
  process.exit(0);
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

export function installFakeCodex(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  try {
    fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  } catch {
    // node may already be linked when the fake claude shares this binDir.
  }
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE || 'ok';
if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  process.exit(mode === 'marketplace-fail' ? 1 : 0);
}
if (args[0] === 'plugin' && args[1] === 'add') {
  process.stdout.write('Installed plugin root: ' + (process.env.FAKE_PLUGIN_ROOT || '') + '\\n');
  process.exit(mode === 'plugin-add-fail' ? 1 : 0);
}
if (args[0] === 'mcp' && args[1] === '--help') {
  process.exit(mode === 'no-mcp' ? 1 : 0);
}
process.exit(0);
`;
  const codexPath = path.join(binDir, 'codex');
  fs.writeFileSync(codexPath, script);
  fs.chmodSync(codexPath, 0o755);
}
