import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  listJobs,
  upsertJob,
} from '../plugins/claude-code-companion/scripts/lib/state.mjs';
import {
  buildEnv,
  COMPANION,
  initGitRepo,
  installFakeClaude,
  makeTempDir,
  MCP_SERVER,
  PLUGIN_ROOT,
  run,
} from './helpers.mjs';

const EXPECTED_KINDS = [
  'review',
  'adversarial_review',
  'diagnose',
  'plan',
  'research',
  'test_gap_review',
  'spec_audit',
  'pr_review_prep',
  'release_risk',
  'architecture_critique',
  'refactor_plan',
  'log_diagnose',
  'dependency_review',
  'security_review',
];

const EXPECTED_COMMANDS = {
  setup: { action: 'setup' },
  review: { action: 'delegate', kind: 'review' },
  'adversarial-review': { action: 'delegate', kind: 'adversarial_review' },
  diagnose: { action: 'delegate', kind: 'diagnose' },
  plan: { action: 'delegate', kind: 'plan' },
  research: { action: 'delegate', kind: 'research' },
  'test-gap-review': { action: 'delegate', kind: 'test_gap_review' },
  'spec-audit': { action: 'delegate', kind: 'spec_audit' },
  'pr-review-prep': { action: 'delegate', kind: 'pr_review_prep' },
  'release-risk': { action: 'delegate', kind: 'release_risk' },
  'architecture-critique': { action: 'delegate', kind: 'architecture_critique' },
  'refactor-plan': { action: 'delegate', kind: 'refactor_plan' },
  'log-diagnose': { action: 'delegate', kind: 'log_diagnose' },
  'dependency-review': { action: 'delegate', kind: 'dependency_review' },
  'security-review': { action: 'delegate', kind: 'security_review' },
  status: { action: 'status' },
  result: { action: 'result' },
  cancel: { action: 'cancel' },
};

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

test('plugin manifest installs as claude from the companion marketplace', () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'),
      'utf8',
    ),
  );
  const mcp = JSON.parse(
    fs.readFileSync(path.join(PLUGIN_ROOT, '.mcp.json'), 'utf8'),
  );
  const marketplace = JSON.parse(
    fs.readFileSync(
      path.join(PLUGIN_ROOT, '..', '..', '.agents', 'plugins', 'marketplace.json'),
      'utf8',
    ),
  );

  assert.equal(manifest.name, 'claude');
  assert.ok(mcp.mcpServers.claude);
  assert.equal(marketplace.name, 'claude-code-companion');
  assert.equal(marketplace.plugins[0].name, 'claude');

  const skillText = fs.readFileSync(
    path.join(PLUGIN_ROOT, 'skills', 'claude', 'SKILL.md'),
    'utf8',
  );
  assert.match(skillText, /name: claude/);
  assert.match(skillText, /\$claude/);
  assert.match(skillText, /companion script/);

  const installer = fs.readFileSync(
    path.join(PLUGIN_ROOT, '..', '..', 'install.sh'),
    'utf8',
  );
  assert.match(installer, /codex mcp add "\$\{marketplace_name\}"/);
  assert.match(installer, /\$claude setup/);
});

test('all command files declare hints and map to claude_code actions', () => {
  for (const [command, expected] of Object.entries(EXPECTED_COMMANDS)) {
    const file = path.join(PLUGIN_ROOT, 'commands', `${command}.md`);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^---[\s\S]*\ndescription: .+\n[\s\S]*---/);
    assert.match(text, /^---[\s\S]*\nargument-hint: .+\n[\s\S]*---/);
    assert.match(text, /claude_code/);
    assert.match(text, new RegExp(`action: "${expected.action}"`));
    if (expected.kind) {
      assert.match(text, new RegExp(`kind: "${expected.kind}"`));
    }
  }
});

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

test('Claude runs with read-only repository tools', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const stdinFile = path.join(makeTempDir(), 'claude-stdin.md');
  const env = buildEnv(binDir, {
    FAKE_CLAUDE_ARGS_FILE: argsFile,
    FAKE_CLAUDE_STDIN_FILE: stdinFile,
  });

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  assert.equal(args[args.indexOf('--model') + 1], 'opus[1m]');
  assert.equal(args[args.indexOf('--effort') + 1], 'max');
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), {
    ultracode: true,
  });
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash');
  assert.match(args[args.indexOf('--allowedTools') + 1], /Read,Glob,Grep/);
  assert.match(args[args.indexOf('--allowedTools') + 1], /Bash\(git diff:\*\)/);
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Edit,Write');
  assert.equal(args.includes('--dangerously-skip-permissions'), false);
  assert.equal(args.includes('--max-budget-usd'), false);
  assert.match(fs.readFileSync(stdinFile, 'utf8'), /dynamic workflows/);
});

test('explicit model and effort override the default Opus Ultracode mode', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });

  const result = run(
    process.execPath,
    [
      COMPANION,
      'review',
      '--cwd',
      repo,
      '--model',
      'sonnet',
      '--effort',
      'xhigh',
      '--json',
    ],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.equal(args[args.indexOf('--effort') + 1], 'xhigh');
  assert.equal(args.includes('--settings'), false);
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

test('read-only mode rejects write flags', () => {
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

test('MCP server exposes exactly one agent-native tool and prompt templates', () => {
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'prompts/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'prompts/get',
      params: {
        name: 'claude_review',
        arguments: { focus: 'API compatibility' },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { input });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.deepEqual(responses[0].result.capabilities, {
    tools: {},
    prompts: {},
  });
  assert.equal(responses[1].result.tools.length, 1);
  assert.equal(responses[1].result.tools[0].name, 'claude_code');
  assert.equal(
    Object.hasOwn(
      responses[1].result.tools[0].inputSchema.properties,
      'max_budget_usd',
    ),
    false,
  );
  assert.deepEqual(
    responses[1].result.tools[0].inputSchema.properties.kind.enum,
    EXPECTED_KINDS,
  );
  assert.ok(
    responses[3].result.messages[0].content.text.includes('claude_code'),
  );
  assert.equal(
    responses[3].result.messages[0].content.text.includes('max_budget_usd'),
    false,
  );
});

test('MCP claude_code delegate action routes to fake Claude review', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: {
          action: 'delegate',
          kind: 'review',
          cwd: repo,
          target: 'working_tree',
        },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { env, input });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const toolText = responses[1].result.content[0].text;
  const payload = JSON.parse(toolText);
  assert.equal(payload.review.verdict, 'changes-needed');
  assert.equal(payload.sessionId, 'fake-session-1');
});

test('MCP claude_code delegate action supports every advertised kind', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);
  let id = 0;
  const input = EXPECTED_KINDS.map((kind) => {
    id += 1;
    return {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: {
          action: 'delegate',
          kind,
          cwd: repo,
          target: ['review', 'adversarial_review'].includes(kind)
            ? 'working_tree'
            : 'none',
          prompt: `Exercise ${kind}.`,
        },
      },
    };
  })
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { env, input });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(responses.length, EXPECTED_KINDS.length);
  for (const [index, kind] of EXPECTED_KINDS.entries()) {
    const payload = JSON.parse(responses[index].result.content[0].text);
    assert.equal(payload.sessionId, 'fake-session-1', kind);
    if (['review', 'adversarial_review'].includes(kind)) {
      assert.equal(payload.review.verdict, 'changes-needed', kind);
    } else {
      assert.equal(payload.rawOutput, 'Handled task', kind);
    }
  }
});

test('MCP claude_code manages background jobs through the same tool', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'slow' });
  const startInput = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: {
          action: 'delegate',
          kind: 'diagnose',
          cwd: repo,
          prompt: 'slow diagnosis',
          background: true,
        },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const started = run(process.execPath, [MCP_SERVER], {
    env,
    input: startInput,
  });
  assert.equal(started.status, 0, started.stderr);
  const startPayload = JSON.parse(
    JSON.parse(started.stdout).result.content[0].text,
  );
  const jobId = startPayload.jobId;
  assert.match(jobId, /^task-/);

  const manageInput = [
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: { action: 'status', cwd: repo, job_id: jobId },
      },
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: { action: 'cancel', cwd: repo, job_id: jobId },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const managed = run(process.execPath, [MCP_SERVER], {
    env,
    input: manageInput,
  });
  assert.equal(managed.status, 0, managed.stderr);
  const responses = managed.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const statusPayload = JSON.parse(responses[0].result.content[0].text);
  const cancelPayload = JSON.parse(responses[1].result.content[0].text);
  assert.equal(statusPayload.jobs[0].id, jobId);
  assert.equal(cancelPayload.status, 'cancelled');
});
