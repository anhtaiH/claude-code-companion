import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  appendLogLine,
  assertValidJobId,
  findIndexedWorkspaceRoot,
  listJobs,
  readJobFile,
  readResultFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveJobResultFile,
  resolveStateFile,
  updateState,
  upsertJob,
  writeJobFile,
  writeResultFile,
} from '../plugins/claude-code-companion/scripts/lib/state.mjs';
import {
  MIN_CLAUDE_CODE_VERSION,
  normalizeReviewPayload,
} from '../plugins/claude-code-companion/scripts/lib/claude.mjs';
import {
  hasSecretLikeText,
  redactSecretLikeText,
} from '../plugins/claude-code-companion/scripts/lib/safety.mjs';
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
];

const EXPECTED_COMMANDS = {
  setup: { action: 'setup' },
  review: { action: 'delegate', kind: 'review' },
  'adversarial-review': { action: 'delegate', kind: 'adversarial_review' },
  diagnose: { action: 'delegate', kind: 'diagnose' },
  plan: { action: 'delegate', kind: 'plan' },
  research: { action: 'delegate', kind: 'research' },
  status: { action: 'status' },
  result: { action: 'result' },
  cancel: { action: 'cancel' },
};
const FAKE_OPENAI_KEY = 'sk-' + 'A'.repeat(40);
const FAKE_PASSWORD_ASSIGNMENT = 'password' + '=hunter2\n';

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

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
  assert.ok(mcp.mcpServers['claude-code-companion']);
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
  assert.match(installer, /min_claude_version="2\.1\.158"/);
  assert.doesNotMatch(installer, /mcp_registered/);
  assert.match(installer, /\$claude setup/);
  // A genuinely fatal install failure exits with a distinct code; MCP
  // registration stays best-effort.
  assert.match(installer, /exit_plugin_add_failed=3/);
  // The Codex `mcp` capability is probed before explicit registration.
  assert.match(installer, /codex mcp --help/);
  // `codex mcp add ... node` must stay on one line so the registration command
  // is well-formed.
  assert.doesNotMatch(installer, /codex mcp add[^\n]*\n[^\n]*node/);
});

test('install.sh version floor matches the code constant (single source of truth)', () => {
  const installer = fs.readFileSync(
    path.join(PLUGIN_ROOT, '..', '..', 'install.sh'),
    'utf8',
  );
  const match = installer.match(/min_claude_version="([0-9.]+)"/);
  assert.ok(match, 'install.sh must declare min_claude_version');
  assert.equal(match[1], MIN_CLAUDE_CODE_VERSION);
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
  assert.equal(payload.claude.version, '2.1.158');
  assert.equal(payload.claude.minimumVersion, '2.1.158');
  assert.equal(payload.claude.supported, true);
  assert.equal(payload.claude.compatibility, 'supported');
  assert.equal(payload.auth.loggedIn, true);
  assert.equal(payload.auth.email, undefined);
  assert.equal(payload.auth.orgId, undefined);
  assert.equal(payload.defaults.model, 'opus[1m]');
  assert.equal(payload.defaults.effort, 'max');
  assert.equal(payload.policy.timeoutMs, 30 * 60 * 1000);
  assert.equal(payload.policy.maxBudgetUsd, null);
  assert.equal(payload.policy.sensitiveContext, 'warn');
  assert.equal(
    payload.policy.strictSensitiveContextFlag,
    '--strict-sensitive-context',
  );
  assert.ok(payload.defaults.subagents.includes('codebase-researcher'));
});

test('setup reports unsupported Claude Code versions before green readiness', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, {
    FAKE_CLAUDE_VERSION: '2.0.0 (Claude Code)',
  });

  const result = run(
    process.execPath,
    [COMPANION, 'setup', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.ready, false);
  assert.equal(payload.claude.version, '2.0.0');
  assert.equal(payload.claude.supported, false);
  assert.equal(payload.claude.compatibility, 'unsupported');
  assert.match(payload.nextSteps.join('\n'), /Update Claude Code/);
});

test('setup warns when Claude Code version output is unparseable', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, {
    FAKE_CLAUDE_VERSION: 'Claude Code dev build',
  });

  const result = run(
    process.execPath,
    [COMPANION, 'setup', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.claude.version, null);
  assert.equal(payload.claude.supported, null);
  assert.equal(payload.claude.compatibility, 'unknown');
  assert.match(payload.warnings.join('\n'), /could not be parsed/);
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

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
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
  assert.equal(payload.rawOutput.includes('Fake review found one issue'), true);
  assert.equal(payload.companion.resultKind, 'structured-review');
  assert.equal(payload.companion.rawOutput, 'preserved');
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
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash,Agent');
  assert.match(
    args[args.indexOf('--allowedTools') + 1],
    /Read,Glob,Grep,Agent/,
  );
  assert.match(args[args.indexOf('--allowedTools') + 1], /Bash\(git diff:\*\)/);
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Edit,Write');
  assert.equal(args.includes('--dangerously-skip-permissions'), false);
  assert.equal(args.includes('--max-budget-usd'), false);
  const agents = JSON.parse(args[args.indexOf('--agents') + 1]);
  assert.deepEqual(Object.keys(agents).sort(), [
    'architecture-critic',
    'codebase-researcher',
    'log-diagnostician',
    'release-risk-reviewer',
    'security-reviewer',
    'test-gap-reviewer',
  ]);
  assert.equal(agents['codebase-researcher'].model, 'opus[1m]');
  assert.equal(agents['codebase-researcher'].effort, 'max');
  assert.equal(agents['codebase-researcher'].background, true);
  assert.deepEqual(agents['codebase-researcher'].tools, [
    'Read',
    'Glob',
    'Grep',
    'Bash',
  ]);
  assert.deepEqual(agents['codebase-researcher'].allowedTools, [
    'Read',
    'Glob',
    'Grep',
    'Bash(git status:*)',
    'Bash(git diff:*)',
    'Bash(git log:*)',
    'Bash(git show:*)',
  ]);
  assert.deepEqual(agents['codebase-researcher'].disallowedTools, [
    'Edit',
    'Write',
  ]);
  assert.match(fs.readFileSync(stdinFile, 'utf8'), /dynamic workflows/);
  assert.match(fs.readFileSync(stdinFile, 'utf8'), /subagents/);
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
  assert.equal(args.includes('--agents'), true);
});

test('explicit max budget is opt-in and forwarded to Claude', () => {
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
      '--max-budget-usd',
      '0.25',
      '--json',
    ],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '0.25');
});

test('repo-scoped review is labeled as repository review', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const stdinFile = path.join(makeTempDir(), 'claude-stdin.md');
  const env = buildEnv(binDir, {
    FAKE_CLAUDE_STDIN_FILE: stdinFile,
  });

  const result = run(
    process.execPath,
    [COMPANION, 'adversarial-review', '--cwd', repo, '--scope', 'repo', '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.targetLabel, 'repository review');
  assert.match(payload.context.shortstat, /Repository review requested/);
  assert.match(payload.rawOutput, /Fake review found one issue/);
  assert.match(fs.readFileSync(stdinFile, 'utf8'), /repository review/);
  assert.doesNotMatch(fs.readFileSync(stdinFile, 'utf8'), /working tree changes/);
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

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.degraded, true);
  assert.equal(payload.review.verdict, 'needs-attention');
  assert.match(payload.review.summary, /could not be parsed/i);
  assert.equal(payload.rawOutput, 'not-json');
});

test('review parser accepts common Claude review object variants', () => {
  const normalized = normalizeReviewPayload(
    JSON.stringify({
      verdict: 'approve',
      summary: 'No blockers.',
      findings: [
        {
          severity: 'info',
          title: 'Opaque constant',
          detail: 'The exported constant has no consumers.',
          location: 'src/app.js:1',
          recommendation: 'No action required.',
        },
      ],
    }),
  );

  assert.equal(normalized.parseError, null);
  assert.equal(normalized.parsed.verdict, 'approve');
  assert.equal(normalized.parsed.findings[0].body, 'The exported constant has no consumers.');
  assert.equal(normalized.parsed.findings[0].file, 'src/app.js');
  assert.equal(normalized.parsed.findings[0].line_start, 1);
  assert.deepEqual(normalized.parsed.next_steps, []);
});

test('review parser accepts grouped severity JSON', () => {
  const normalized = normalizeReviewPayload(
    JSON.stringify({
      critical: [],
      high: [
        {
          title: 'Deploy is not gated on CI',
          detail: 'Deploy can run independently of CI.',
          location: '.github/workflows/deploy.yml:9',
          recommendation: 'Gate deploy on CI success.',
        },
      ],
      medium: ['Rollback runbook is thin. Evidence: runbooks/deploy.md:12'],
      low: 'No findings.',
    }),
  );

  assert.equal(normalized.parseError, null);
  assert.equal(normalized.parsed.verdict, 'changes-needed');
  assert.equal(normalized.parsed.findings.length, 2);
  assert.equal(normalized.parsed.findings[0].severity, 'high');
  assert.equal(
    normalized.parsed.findings[0].file,
    '.github/workflows/deploy.yml',
  );
  assert.equal(normalized.parsed.findings[0].line_start, 9);
  assert.equal(normalized.parsed.findings[1].severity, 'medium');
  assert.equal(normalized.parsed.findings[1].file, 'runbooks/deploy.md');
});

test('review parser accepts markdown severity sections', () => {
  const normalized = normalizeReviewPayload(`
**Critical**
No Critical findings.

**High**
- Deploy is not gated on CI. Evidence: .github/workflows/deploy.yml:9.

**Medium**
- Rollback runbook is thin. Evidence: runbooks/deploy.md:12.

**Low**
None.
`);

  assert.equal(normalized.parseError, null);
  assert.equal(normalized.parsed.verdict, 'changes-needed');
  assert.equal(normalized.parsed.findings.length, 2);
  assert.equal(normalized.parsed.findings[0].severity, 'high');
  assert.equal(
    normalized.parsed.findings[0].file,
    '.github/workflows/deploy.yml',
  );
  assert.equal(normalized.parsed.findings[0].line_start, 9);
});

test('review parser stops markdown severity sections at non-severity headings', () => {
  const normalized = normalizeReviewPayload(`
**Findings**

Critical: none confirmed by Claude.

High:
- Persisted state is not migrated. Evidence: src/store/useStore.ts:413.
  Risk: stale localStorage can reach engine paths.

**Companion Notes**

- Setup worked: ready true.
- Status showed model and effort.

**Companion Observations**: rawOutput was preserved.
`);

  assert.equal(normalized.parseError, null);
  assert.equal(normalized.parsed.verdict, 'changes-needed');
  assert.equal(normalized.parsed.findings.length, 1);
  assert.equal(normalized.parsed.findings[0].severity, 'high');
  assert.equal(normalized.parsed.findings[0].file, 'src/store/useStore.ts');
  assert.equal(normalized.parsed.findings[0].line_start, 413);
  assert.match(normalized.parsed.findings[0].body, /Risk: stale localStorage/);
  assert.doesNotMatch(normalized.parsed.findings[0].body, /Setup worked/);
});

test('review parser accepts markdown finding headings with severity', () => {
  const normalized = normalizeReviewPayload(`
## Findings

### Finding 1 - HIGH - Task workflow prompts are untested
Runtime changed in plugins/claude-code-companion/scripts/claude-companion.mjs:385.

### MEDIUM - Task warnings are not rendered
Evidence: plugins/claude-code-companion/scripts/lib/render.mjs:97.
`);

  assert.equal(normalized.parseError, null);
  assert.equal(normalized.parsed.verdict, 'changes-needed');
  assert.equal(normalized.parsed.findings.length, 2);
  assert.equal(normalized.parsed.findings[0].severity, 'high');
  assert.equal(
    normalized.parsed.findings[0].title,
    'Task workflow prompts are untested',
  );
  assert.equal(
    normalized.parsed.findings[0].file,
    'plugins/claude-code-companion/scripts/claude-companion.mjs',
  );
  assert.equal(normalized.parsed.findings[0].line_start, 385);
  assert.equal(normalized.parsed.findings[1].severity, 'medium');
});

test('review parser keeps numbered subheadings inside severity sections', () => {
  const normalized = normalizeReviewPayload(`
## HIGH

### H1. Installer hard-aborts on setup output drift
- File: install.sh:38
- Evidence: plugin root is parsed from one stdout marker.

### H2. Background results can be orphaned
- Evidence: plugins/claude-code-companion/scripts/lib/state.mjs:53

## MEDIUM

### M1. Uninstall path is missing
- Evidence: docs/INSTALL.md:1
`);

  assert.equal(normalized.parseError, null);
  assert.equal(normalized.parsed.verdict, 'changes-needed');
  assert.equal(normalized.parsed.findings.length, 3);
  assert.equal(normalized.parsed.findings[0].severity, 'high');
  assert.equal(
    normalized.parsed.findings[0].title,
    'Installer hard-aborts on setup output drift',
  );
  assert.equal(normalized.parsed.findings[0].file, 'install.sh');
  assert.equal(normalized.parsed.findings[0].line_start, 38);
  assert.equal(normalized.parsed.findings[2].severity, 'medium');
});

test('OpenAI key heuristic avoids English slug false positives', () => {
  assert.equal(
    hasSecretLikeText('hooks/pre-task-confidentiality-check.md'),
    false,
  );
  assert.equal(
    redactSecretLikeText('hooks/pre-task-confidentiality-check.md'),
    'hooks/pre-task-confidentiality-check.md',
  );
  assert.equal(
    redactSecretLikeText('Claude mentioned a grep pattern for BEGIN PRIVATE KEY.'),
    'Claude mentioned a grep pattern for BEGIN PRIVATE KEY.',
  );
  assert.equal(
    hasSecretLikeText('Claude mentioned a grep pattern for BEGIN PRIVATE KEY.'),
    false,
  );
  assert.equal(
    redactSecretLikeText('-----BEGIN PRIVATE KEY-----'),
    '[REDACTED:private-key]',
  );
  assert.equal(hasSecretLikeText('-----BEGIN PRIVATE KEY-----'), true);
  assert.equal(hasSecretLikeText(FAKE_OPENAI_KEY), true);
});

test('secret heuristic catches common token shapes and quoted assignments', () => {
  assert.equal(hasSecretLikeText('ghp_' + 'A'.repeat(36)), true);
  assert.equal(hasSecretLikeText('github_pat_' + 'A'.repeat(30)), true);
  assert.equal(hasSecretLikeText('xoxb-' + '1234567890-'.repeat(3)), true);
  assert.equal(hasSecretLikeText('AIza' + 'A'.repeat(35)), true);
  assert.equal(hasSecretLikeText('sk_live_' + 'A'.repeat(24)), true);
  assert.equal(hasSecretLikeText('npm_' + 'A'.repeat(24)), true);
  assert.equal(
    hasSecretLikeText(
      'eyJ' + 'A'.repeat(12) + '.' + 'B'.repeat(12) + '.' + 'C'.repeat(12),
    ),
    true,
  );
  assert.equal(hasSecretLikeText('"token": "' + 'A'.repeat(12) + '"'), true);
  assert.equal(hasSecretLikeText('export API_KEY=' + 'A'.repeat(12)), true);
});

test('review uses assistant transcript when result event is only progress', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'assistant-final' });

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review.verdict, 'approve');
  assert.equal(payload.review.summary, 'Assistant transcript carried the final review.');
  assert.equal(payload.parseError, null);
  assert.equal(payload.claude.resultTextSource, 'assistant-events');
});

test('review uses final assistant message instead of progress chatter', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'assistant-chatter' });

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review.verdict, 'approve');
  assert.equal(payload.review.summary, 'Final assistant message carried the review.');
  assert.equal(payload.rawOutput.includes('I will inspect the repo first.'), false);
  assert.equal(payload.claude.resultTextSource, 'assistant-events');
});

test('streamed subagent events parse the final Claude result', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'stream-json' });

  const result = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--json', 'inspect with subagents'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.rawOutput, 'Handled stream result');
  assert.equal(payload.sessionId, 'fake-session-stream');
  assert.equal(payload.claude.eventCount, 2);
  assert.equal(payload.companion.resultKind, 'task-output');
  assert.equal(payload.companion.rawOutput, 'preserved');
  assert.equal(payload.companion.sensitiveContext, 'clear');
  assert.equal(
    payload.companion.resultTextSource,
    payload.claude.resultTextSource,
  );
});

test('task prompts include kind-specific workflow guidance', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const stdinFile = path.join(makeTempDir(), 'claude-stdin.md');
  const env = buildEnv(binDir, { FAKE_CLAUDE_STDIN_FILE: stdinFile });

  const result = run(
    process.execPath,
    [
      COMPANION,
      'task',
      '--cwd',
      repo,
      '--kind',
      'diagnose',
      '--json',
      'diagnose checkout failure',
    ],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const stdin = fs.readFileSync(stdinFile, 'utf8');
  assert.match(stdin, /## Work Mode/);
  assert.match(stdin, /Diagnose mode:/);
  assert.match(stdin, /## Output Contract/);
  assert.match(stdin, /## Current Change Context/);
  assert.match(stdin, /Shortstat:/);
  assert.match(stdin, /## Tracked Diff/);
  assert.match(stdin, /export const value = items\[0\]\.id;/);
});

test('resume task keeps the base kind workflow guidance', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const stateDir = makeTempDir();
  const stdinFile = path.join(makeTempDir(), 'claude-stdin.md');
  const env = buildEnv(binDir, {
    CLAUDE_CODE_COMPANION_STATE_DIR: stateDir,
    FAKE_CLAUDE_STDIN_FILE: stdinFile,
  });

  const first = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--kind', 'diagnose', '--json', 'first'],
    { env },
  );
  assert.equal(first.status, 0, first.stderr);

  const second = run(
    process.execPath,
    [
      COMPANION,
      'task',
      '--cwd',
      repo,
      '--kind',
      'diagnose',
      '--resume-last',
      '--json',
    ],
    { env },
  );

  assert.equal(second.status, 0, second.stderr);
  const stdin = fs.readFileSync(stdinFile, 'utf8');
  assert.match(stdin, /Diagnose mode:/);
});

test('timed out task persists a normal failed result', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'slow' });

  const result = run(
    process.execPath,
    [
      COMPANION,
      'task',
      '--cwd',
      repo,
      '--timeout-ms',
      '5',
      '--json',
      'slow diagnosis',
    ],
    { env },
  );

  assert.equal(result.status, 124);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.rawOutput, /timed out/i);
  assert.match(payload.claude.error, /timed out/i);

  const stored = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, '--json'],
    { env },
  );
  assert.equal(stored.status, 0, stored.stderr);
  const storedPayload = JSON.parse(stored.stdout);
  assert.equal(storedPayload.job.status, 'failed');
  assert.match(storedPayload.result.rawOutput, /timed out/i);
});

test('nonzero empty-output task persists a normal failed result', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'nonzero' });

  const result = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--json', 'failing diagnosis'],
    { env },
  );

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.rawOutput, /simulated claude failure/);
  assert.equal(payload.claude.status, 2);

  const stored = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, '--json'],
    { env },
  );
  assert.equal(stored.status, 0, stored.stderr);
  const storedPayload = JSON.parse(stored.stdout);
  assert.equal(storedPayload.job.status, 'failed');
  assert.match(storedPayload.result.rawOutput, /simulated claude failure/);
});

test('secret-like Claude output is redacted and persisted', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'secret' });

  const result = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, 'diagnose', '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(JSON.stringify(payload).includes(FAKE_OPENAI_KEY), false);
  assert.match(payload.rawOutput, /\[REDACTED:token-assignment\]/);
  assert.ok(payload.redactions.some((entry) => entry.category === 'openai-api-key'));
  assert.ok(
    payload.companion.outputRedactions.some(
      (entry) => entry.category === 'openai-api-key',
    ),
  );

  const stored = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, '--json'],
    { env },
  );
  assert.equal(stored.status, 0, stored.stderr);
  const storedPayload = JSON.parse(stored.stdout);
  assert.equal(storedPayload.result.rawOutput, payload.rawOutput);
});

test('secret-like tracked diff warns and still invokes Claude by default', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });
  fs.writeFileSync(
    path.join(repo, 'src', 'app.js'),
    `export const token = '${FAKE_OPENAI_KEY}';\n`,
  );

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review.verdict, 'changes-needed');
  assert.equal(payload.warnings[0].type, 'sensitive-context-detected');
  assert.ok(
    payload.warnings[0].findings.some(
      (entry) =>
        entry.sourceKind === 'tracked-diff' &&
        entry.category === 'openai-api-key',
    ),
  );
  assert.equal(payload.companion.sensitiveContext, 'warned');
  assert.equal(fs.existsSync(argsFile), true);

  const stored = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, '--json'],
    { env },
  );
  assert.equal(stored.status, 0, stored.stderr);
  const storedPayload = JSON.parse(stored.stdout);
  assert.equal(
    storedPayload.result.warnings[0].type,
    'sensitive-context-detected',
  );
  assert.equal(storedPayload.result.companion.sensitiveContext, 'warned');
});

test('secret-like untracked file warns and still invokes Claude by default', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });
  fs.writeFileSync(path.join(repo, 'scratch.env'), FAKE_PASSWORD_ASSIGNMENT);

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(
    payload.warnings[0].findings.some(
      (entry) =>
        entry.sourceKind === 'untracked-file' &&
        entry.path === 'scratch.env' &&
        entry.category === 'password-assignment',
    ),
  );
  assert.equal(fs.existsSync(argsFile), true);
});

test('legacy allow-sensitive-context flag is accepted as warn-mode compatibility', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });
  fs.writeFileSync(
    path.join(repo, 'src', 'app.js'),
    `export const token = '${FAKE_OPENAI_KEY}';\n`,
  );

  const result = run(
    process.execPath,
    [
      COMPANION,
      'review',
      '--cwd',
      repo,
      '--allow-sensitive-context',
      '--json',
    ],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.warnings[0].type, 'sensitive-context-detected');
  assert.equal(payload.companion.sensitiveContext, 'warned');
  assert.equal(fs.existsSync(argsFile), true);
});

test('gitignored secret-like files are skipped from outbound scanning', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = makeTempDir();
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'secrets.env\n');
  run('git', ['add', '.gitignore'], { cwd: repo });
  run('git', ['commit', '-m', 'ignore secrets'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'secrets.env'), FAKE_PASSWORD_ASSIGNMENT);
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.review.verdict, 'changes-needed');
});

test('strict sensitive-context mode blocks before Claude is invoked', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });
  fs.writeFileSync(
    path.join(repo, 'src', 'app.js'),
    `export const token = '${FAKE_OPENAI_KEY}';\n`,
  );

  const result = run(
    process.execPath,
    [
      COMPANION,
      'review',
      '--cwd',
      repo,
      '--strict-sensitive-context',
      '--json',
    ],
    { env },
  );

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, 'SensitiveContextError');
  assert.ok(
    payload.sensitiveContext.some(
      (entry) =>
        entry.sourceKind === 'tracked-diff' &&
        entry.category === 'openai-api-key',
    ),
  );
  assert.equal(fs.existsSync(argsFile), false);
});

test('strict sensitive-context mode blocks task prompts before Claude is invoked', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });

  const result = run(
    process.execPath,
    [
      COMPANION,
      'task',
      '--cwd',
      repo,
      '--strict-sensitive-context',
      '--json',
      `diagnose token=${FAKE_OPENAI_KEY}`,
    ],
    { env },
  );

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.code, 'SensitiveContextError');
  assert.ok(
    payload.sensitiveContext.some(
      (entry) =>
        entry.sourceKind === 'task-prompt' &&
        entry.category === 'openai-api-key',
    ),
  );
  assert.equal(fs.existsSync(argsFile), false);
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
  const statusJob = JSON.parse(status.stdout).jobs[0];
  assert.equal(statusJob.id, jobId);
  assert.equal(statusJob.model, 'opus[1m]');
  assert.equal(statusJob.effort, 'max');

  const cancel = run(
    process.execPath,
    [COMPANION, 'cancel', '--cwd', repo, jobId, '--json'],
    { env },
  );
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.equal(JSON.parse(cancel.stdout).status, 'cancelled');
});

test('background task completes and result is fetched without transcript recovery', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const started = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--background', 'inspect', '--json'],
    { env },
  );
  assert.equal(started.status, 0, started.stderr);
  const jobId = JSON.parse(started.stdout).jobId;

  let statusPayload = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = run(
      process.execPath,
      [COMPANION, 'status', '--cwd', repo, jobId, '--json'],
      { env },
    );
    assert.equal(status.status, 0, status.stderr);
    statusPayload = JSON.parse(status.stdout);
    if (statusPayload.jobs[0]?.status === 'completed') break;
    sleep(50);
  }

  assert.equal(statusPayload.jobs[0].status, 'completed');
  const result = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, jobId, '--json'],
    { env },
  );
  assert.equal(result.status, 0, result.stderr);
  const resultPayload = JSON.parse(result.stdout);
  assert.equal(resultPayload.result.rawOutput, 'Handled task');
  assert.equal(resultPayload.ok, true);
  assert.equal(resultPayload.kind, 'result');
  assert.equal(resultPayload.answer, 'Handled task');
});

test('a completed background job does not persist the raw prompt or request', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const stateDir = makeTempDir();
  const env = buildEnv(binDir, { CLAUDE_CODE_COMPANION_STATE_DIR: stateDir });

  const started = run(
    process.execPath,
    [
      COMPANION,
      'task',
      '--cwd',
      repo,
      '--background',
      '--json',
      `diagnose token=${FAKE_OPENAI_KEY}`,
    ],
    { env },
  );
  assert.equal(started.status, 0, started.stderr);
  const jobId = JSON.parse(started.stdout).jobId;

  let completed = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = run(
      process.execPath,
      [COMPANION, 'status', '--cwd', repo, jobId, '--json'],
      { env },
    );
    if (JSON.parse(status.stdout).jobs[0]?.status === 'completed') {
      completed = true;
      break;
    }
    sleep(50);
  }
  assert.equal(completed, true);

  // The detached worker still ran (it re-read request.prompt while queued), but
  // the terminal record drops request and never persists the raw secret.
  const previous = process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
  process.env.CLAUDE_CODE_COMPANION_STATE_DIR = stateDir;
  try {
    const stored = readJobFile(repo, jobId);
    assert.ok(!stored.request, 'terminal record must not retain the request');
    assert.equal(
      fs.readFileSync(resolveJobFile(repo, jobId), 'utf8').includes(FAKE_OPENAI_KEY),
      false,
    );
    assert.equal(
      fs.readFileSync(resolveStateFile(repo), 'utf8').includes(FAKE_OPENAI_KEY),
      false,
    );
  } finally {
    if (previous === undefined)
      delete process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
    else process.env.CLAUDE_CODE_COMPANION_STATE_DIR = previous;
  }
});

test('a queued job summary is redacted for secret-shaped prompts', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'slow' });

  const started = run(
    process.execPath,
    [
      COMPANION,
      'task',
      '--cwd',
      repo,
      '--background',
      '--json',
      `token=${FAKE_OPENAI_KEY} investigate`,
    ],
    { env },
  );
  assert.equal(started.status, 0, started.stderr);
  const jobId = JSON.parse(started.stdout).jobId;

  const status = run(
    process.execPath,
    [COMPANION, 'status', '--cwd', repo, jobId, '--json'],
    { env },
  );
  assert.equal(status.status, 0, status.stderr);
  const job = JSON.parse(status.stdout).jobs[0];
  assert.equal(job.summary.includes(FAKE_OPENAI_KEY), false);
  assert.match(job.summary, /\[REDACTED:/);

  run(
    process.execPath,
    [COMPANION, 'cancel', '--cwd', repo, jobId, '--json'],
    { env },
  );
});

test('background result can be fetched by job id after cwd drift', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const otherRepo = tempRepo();
  const env = buildEnv(binDir);

  const started = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--background', 'inspect', '--json'],
    { env },
  );
  assert.equal(started.status, 0, started.stderr);
  const startPayload = JSON.parse(started.stdout);
  const jobId = startPayload.jobId;
  assert.equal(startPayload.workspaceRoot, fs.realpathSync.native(repo));

  let completed = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = run(
      process.execPath,
      [COMPANION, 'status', '--cwd', repo, jobId, '--json'],
      { env },
    );
    assert.equal(status.status, 0, status.stderr);
    if (JSON.parse(status.stdout).jobs[0]?.status === 'completed') {
      completed = true;
      break;
    }
    sleep(50);
  }
  assert.equal(completed, true);

  const result = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', otherRepo, jobId, '--json'],
    { env },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.workspaceRoot, fs.realpathSync.native(repo));
  assert.equal(payload.job.id, jobId);
  assert.equal(payload.result.rawOutput, 'Handled task');
});

test('exception-failed background jobs persist a failed result', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = makeTempDir();
  const env = buildEnv(binDir);

  const started = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--background', '--json'],
    { env },
  );
  assert.equal(started.status, 0, started.stderr);
  const jobId = JSON.parse(started.stdout).jobId;

  let failed = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = run(
      process.execPath,
      [COMPANION, 'status', '--cwd', repo, jobId, '--json'],
      { env },
    );
    assert.equal(status.status, 0, status.stderr);
    if (JSON.parse(status.stdout).jobs[0]?.status === 'failed') {
      failed = true;
      break;
    }
    sleep(50);
  }
  assert.equal(failed, true);

  const result = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, jobId, '--json'],
    { env },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.job.status, 'failed');
  assert.equal(payload.result.companion.resultKind, 'failed-review');
  assert.match(payload.result.review.summary, /failed before producing a result/);
});

test('result refreshes stale running jobs before returning', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);
  const jobId = 'task-test-stale';

  run(process.execPath, [COMPANION, 'setup', '--cwd', repo, '--json'], { env });
  const previous = process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
  process.env.CLAUDE_CODE_COMPANION_STATE_DIR =
    env.CLAUDE_CODE_COMPANION_STATE_DIR;
  try {
    upsertJob(repo, {
      id: jobId,
      workspaceRoot: repo,
      kind: 'task',
      jobClass: 'task',
      status: 'running',
      phase: 'running',
      pid: 99999999,
      summary: 'stale task',
    });
    writeJobFile(repo, jobId, {
      id: jobId,
      workspaceRoot: repo,
      kind: 'task',
      jobClass: 'task',
      status: 'running',
      phase: 'running',
      pid: 99999999,
      summary: 'stale task',
    });
  } finally {
    if (previous === undefined)
      delete process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
    else process.env.CLAUDE_CODE_COMPANION_STATE_DIR = previous;
  }

  const result = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, jobId, '--json'],
    { env },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.job.status, 'failed');
  assert.equal(payload.job.errorMessage, 'Worker process is no longer running.');
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

test('pruning a job deletes its on-disk artifacts and index entry', () => {
  const workspace = makeTempDir();
  const stateDir = makeTempDir();
  const previous = process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
  process.env.CLAUDE_CODE_COMPANION_STATE_DIR = stateDir;
  try {
    for (let index = 0; index < 55; index += 1) {
      const id = `job-${index}`;
      const job = {
        id,
        workspaceRoot: workspace,
        kind: 'task',
        jobClass: 'task',
        status: 'completed',
        updatedAt: new Date(Date.now() + index).toISOString(),
      };
      writeJobFile(workspace, id, job);
      writeResultFile(workspace, id, { ok: true });
      appendLogLine(resolveJobLogFile(workspace, id), 'done');
      upsertJob(workspace, job);
    }
    assert.equal(listJobs(workspace).length, 50);
    assert.equal(fs.existsSync(resolveJobFile(workspace, 'job-0')), false);
    assert.equal(fs.existsSync(resolveJobLogFile(workspace, 'job-0')), false);
    assert.equal(fs.existsSync(resolveJobResultFile(workspace, 'job-0')), false);
    assert.equal(findIndexedWorkspaceRoot('job-0'), null);
    assert.equal(fs.existsSync(resolveJobFile(workspace, 'job-54')), true);
    assert.ok(findIndexedWorkspaceRoot('job-54'));
  } finally {
    if (previous === undefined)
      delete process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
    else process.env.CLAUDE_CODE_COMPANION_STATE_DIR = previous;
  }
});

test('an active job keeps its files even when pruned from the newest window', () => {
  const workspace = makeTempDir();
  const stateDir = makeTempDir();
  const previous = process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
  process.env.CLAUDE_CODE_COMPANION_STATE_DIR = stateDir;
  try {
    const activeId = 'task-active-old';
    writeJobFile(workspace, activeId, { id: activeId, status: 'running' });
    // A new insert keeps a caller-supplied (old) updatedAt, so this job lands
    // outside the newest-50 window once newer jobs arrive.
    upsertJob(workspace, {
      id: activeId,
      status: 'running',
      pid: 999999,
      updatedAt: new Date(Date.now() - 1_000_000).toISOString(),
    });
    for (let index = 0; index < 50; index += 1) {
      upsertJob(workspace, {
        id: `job-${index}`,
        status: 'completed',
        updatedAt: new Date(Date.now() + index).toISOString(),
      });
    }
    assert.equal(listJobs(workspace).length, 50);
    assert.equal(
      listJobs(workspace).some((job) => job.id === activeId),
      false,
    );
    assert.equal(fs.existsSync(resolveJobFile(workspace, activeId)), true);
  } finally {
    if (previous === undefined)
      delete process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
    else process.env.CLAUDE_CODE_COMPANION_STATE_DIR = previous;
  }
});

test('repeated prune cleanup is idempotent', () => {
  const workspace = makeTempDir();
  const stateDir = makeTempDir();
  const previous = process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
  process.env.CLAUDE_CODE_COMPANION_STATE_DIR = stateDir;
  try {
    for (let index = 0; index < 55; index += 1) {
      const id = `job-${index}`;
      const job = {
        id,
        status: 'completed',
        updatedAt: new Date(Date.now() + index).toISOString(),
      };
      writeJobFile(workspace, id, job);
      upsertJob(workspace, job);
    }
    assert.doesNotThrow(() => updateState(workspace, () => {}));
    assert.equal(listJobs(workspace).length, 50);
    assert.equal(fs.existsSync(resolveJobFile(workspace, 'job-0')), false);
  } finally {
    if (previous === undefined)
      delete process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
    else process.env.CLAUDE_CODE_COMPANION_STATE_DIR = previous;
  }
});

test('corrupt state files recover to an empty job list', () => {
  const workspace = makeTempDir();
  const stateDir = makeTempDir();
  const previous = process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
  process.env.CLAUDE_CODE_COMPANION_STATE_DIR = stateDir;
  try {
    const stateFile = resolveStateFile(workspace);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, '{not valid json');
    assert.deepEqual(listJobs(workspace), []);
  } finally {
    if (previous === undefined)
      delete process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
    else process.env.CLAUDE_CODE_COMPANION_STATE_DIR = previous;
  }
});

test('corrupt job and result files fail closed without throwing', () => {
  const workspace = makeTempDir();
  const stateDir = makeTempDir();
  const previous = process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
  process.env.CLAUDE_CODE_COMPANION_STATE_DIR = stateDir;
  try {
    const jobId = 'task-test-corrupt';
    writeJobFile(workspace, jobId, { id: jobId, status: 'completed' });
    fs.writeFileSync(resolveJobResultFile(workspace, jobId), '{bad result');

    assert.deepEqual(readJobFile(workspace, jobId), {
      id: jobId,
      status: 'completed',
    });
    assert.equal(readResultFile(workspace, jobId), null);

    const badJobId = 'task-test-badjob';
    const badJobPath = path.join(
      path.dirname(resolveJobResultFile(workspace, badJobId)),
      `${badJobId}.json`,
    );
    fs.writeFileSync(badJobPath, '{bad job');
    assert.equal(readJobFile(workspace, badJobId), null);
  } finally {
    if (previous === undefined)
      delete process.env.CLAUDE_CODE_COMPANION_STATE_DIR;
    else process.env.CLAUDE_CODE_COMPANION_STATE_DIR = previous;
  }
});

test('job id traversal is rejected', () => {
  assert.throws(() => assertValidJobId('../bad'), /Invalid/);
  assert.throws(() => assertValidJobId('task-bad/evil'), /Invalid/);
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
    true,
  );
  assert.equal(
    Object.hasOwn(
      responses[1].result.tools[0].inputSchema.properties,
      'allow_sensitive_context',
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(
      responses[1].result.tools[0].inputSchema.properties,
      'strict_sensitive_context',
    ),
    true,
  );
  assert.ok(
    responses[1].result.tools[0].inputSchema.properties.target.enum.includes(
      'repo',
    ),
  );
  assert.equal(
    responses[1].result.tools[0].inputSchema.properties.target.enum.includes(
      'none',
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
  assert.ok(
    responses[3].result.messages[0].content.text.includes(
      'active workspace `cwd`',
    ),
  );
});

test('MCP setup infers workspace from session PWD when cwd is omitted', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: { action: 'setup' },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], {
    cwd: PLUGIN_ROOT,
    env: buildEnv(binDir, { PWD: repo }),
    input,
  });

  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout.trim());
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.workspaceRoot, fs.realpathSync.native(repo));
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

test('MCP claude_code forwards budget and warns on sensitive context by default', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });
  fs.writeFileSync(
    path.join(repo, 'src', 'app.js'),
    `export const token = '${FAKE_OPENAI_KEY}';\n`,
  );
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: {
          action: 'delegate',
          kind: 'review',
          cwd: repo,
          target: 'working_tree',
          max_budget_usd: 0.5,
        },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { env, input });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, false);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.warnings[0].type, 'sensitive-context-detected');
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  assert.equal(args[args.indexOf('--max-budget-usd') + 1], '0.5');
});

test('MCP claude_code supports repo target and strict sensitive-context mode', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const stdinFile = path.join(makeTempDir(), 'claude-stdin.md');
  const env = buildEnv(binDir, { FAKE_CLAUDE_STDIN_FILE: stdinFile });
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: {
          action: 'delegate',
          kind: 'adversarial_review',
          cwd: repo,
          target: 'repo',
          strict_sensitive_context: true,
        },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { env, input });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, false);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.targetLabel, 'repository review');
  assert.match(fs.readFileSync(stdinFile, 'utf8'), /repository review/);
});

test('MCP review rejects target none to avoid accidental repo review', () => {
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: {
          action: 'delegate',
          kind: 'review',
          target: 'none',
        },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { input });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /target "repo"/);
});

test('MCP strict sensitive-context mode blocks and reports an error', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });
  fs.writeFileSync(
    path.join(repo, 'src', 'app.js'),
    `export const token = '${FAKE_OPENAI_KEY}';\n`,
  );
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: {
          action: 'delegate',
          kind: 'review',
          cwd: repo,
          target: 'working_tree',
          strict_sensitive_context: true,
        },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { env, input });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /SensitiveContextError/);
  assert.equal(fs.existsSync(argsFile), false);
});

test('MCP claude_code rejects write and dangerous inputs', () => {
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: {
          action: 'delegate',
          kind: 'diagnose',
          prompt: 'fix this',
          write: true,
        },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { input });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /read-only/i);
});

test('MCP keeps dash-leading user prompt text positional', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const stdinFile = path.join(makeTempDir(), 'claude-stdin.md');
  const env = buildEnv(binDir, { FAKE_CLAUDE_STDIN_FILE: stdinFile });
  const input = [
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
          prompt: '--scope repo should stay prompt text',
        },
      },
    },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n');

  const result = run(process.execPath, [MCP_SERVER], { env, input });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    fs.readFileSync(stdinFile, 'utf8'),
    /Request: --scope repo should stay prompt text/,
  );
});

test('MCP foreground calls do not block later lifecycle messages', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'slow' });
  const input = [
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
          timeout_ms: 800,
          prompt: 'slow foreground diagnosis',
        },
      },
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'claude_code',
        arguments: { action: 'status', cwd: repo },
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
  assert.equal(responses[0].id, 2);
  assert.equal(responses[0].result.isError, false);
  assert.equal(responses[1].id, 1);
  assert.equal(responses[1].result.isError, true);
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
          ...(['review', 'adversarial_review'].includes(kind)
            ? { target: 'working_tree' }
            : {}),
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
    const response = responses.find((entry) => entry.id === index + 1);
    assert.ok(response, `missing response for ${kind}`);
    const payload = JSON.parse(response.result.content[0].text);
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
  const statusResponse = responses.find((entry) => entry.id === 2);
  const cancelResponse = responses.find((entry) => entry.id === 3);
  assert.ok(statusResponse);
  assert.ok(cancelResponse);
  const statusPayload = JSON.parse(statusResponse.result.content[0].text);
  const cancelPayload = JSON.parse(cancelResponse.result.content[0].text);
  assert.equal(statusPayload.jobs[0].id, jobId);
  assert.equal(cancelPayload.status, 'cancelled');
});

test('invalid --timeout-ms is rejected before Claude is invoked', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });

  for (const bad of ['abc', '-5', '1.5', '0']) {
    const result = run(
      process.execPath,
      [COMPANION, 'review', '--cwd', repo, '--timeout-ms', bad, '--json'],
      { env },
    );
    assert.notEqual(result.status, 0, `expected failure for ${bad}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /timeout-ms/);
  }
  assert.equal(fs.existsSync(argsFile), false);
});

test('review result carries the ok/kind/answer envelope', () => {
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
  assert.equal(payload.ok, true);
  assert.equal(payload.degraded, false);
  assert.equal(payload.kind, 'review');
  assert.match(payload.answer, /changes-needed/);
});

test('task result carries the ok/kind envelope', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--kind', 'diagnose', '--json', 'inspect'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, 'diagnose');
  assert.equal(payload.answer, 'Handled task');
});

test('malformed review is reported as not-ok and degraded', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir, { FAKE_CLAUDE_MODE: 'malformed' });

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.degraded, true);
  assert.equal(payload.review.verdict, 'needs-attention');
});

test('unknown task kind is rejected with a clear error', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--kind', 'frobnicate', '--json', 'go'],
    { env },
  );

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Unknown task kind/);
});

test('delegate fails clearly when Claude Code is not installed', () => {
  const binDir = makeTempDir();
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  const repo = tempRepo();
  const env = buildEnv(binDir, { PATH: binDir });

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--json'],
    { env },
  );

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Claude Code CLI/);
  assert.match(payload.error, /setup/);
});

test('branch review resolves the default base when main is absent', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = makeTempDir();
  run('git', ['init', '-b', 'master'], { cwd: repo });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  run('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.js'), 'export const a = 1;\n');
  run('git', ['add', 'a.js'], { cwd: repo });
  run('git', ['commit', '-m', 'init'], { cwd: repo });
  run('git', ['checkout', '-b', 'feature'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.js'), 'export const a = 2;\n');
  run('git', ['add', 'a.js'], { cwd: repo });
  run('git', ['commit', '-m', 'change'], { cwd: repo });
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--scope', 'branch', '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.targetLabel, 'changes against master');
  assert.equal(payload.context.diffError, null);
  assert.equal(payload.ok, true);
});

test('branch review without a resolvable base degrades instead of faking a verdict', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = makeTempDir();
  run('git', ['init', '-b', 'wip'], { cwd: repo });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  run('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.js'), 'export const a = 1;\n');
  run('git', ['add', 'a.js'], { cwd: repo });
  run('git', ['commit', '-m', 'init'], { cwd: repo });
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--scope', 'branch', '--json'],
    { env },
  );

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /base branch/);
  assert.equal(fs.existsSync(argsFile), false);
});

test('result for an unknown job id reports an error and exits nonzero', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, 'task-zzz-zzzzzz', '--json'],
    { env },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /No Claude Code Companion job matching/);
});

test('status for an unknown job id reports an error and exits nonzero', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'status', '--cwd', repo, 'task-zzz-zzzzzz', '--json'],
    { env },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /No Claude Code Companion job matching/);
});

test('off-enum finding severities and verdicts are clamped', () => {
  const normalized = normalizeReviewPayload(
    JSON.stringify({
      verdict: 'approved',
      summary: 'ok',
      findings: [
        { severity: 'blocker', title: 'a', detail: 'b', location: 'a.js:1' },
        { severity: 'info', title: 'c', detail: 'd', location: 'a.js:2' },
        { severity: 'whatever', title: 'e', detail: 'f', location: 'a.js:3' },
      ],
    }),
  );

  assert.equal(normalized.parseError, null);
  assert.equal(normalized.parsed.verdict, 'approve');
  assert.equal(normalized.parsed.findings[0].severity, 'critical');
  assert.equal(normalized.parsed.findings[1].severity, 'low');
  assert.equal(normalized.parsed.findings[2].severity, 'low');
});

test('cancel on an already-finished job does not relabel it', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const done = run(
    process.execPath,
    [COMPANION, 'task', '--cwd', repo, '--json', 'quick task'],
    { env },
  );
  assert.equal(done.status, 0, done.stderr);

  const status = run(
    process.execPath,
    [COMPANION, 'status', '--cwd', repo, '--json'],
    { env },
  );
  const jobId = JSON.parse(status.stdout).jobs[0].id;

  const cancel = run(
    process.execPath,
    [COMPANION, 'cancel', '--cwd', repo, jobId, '--json'],
    { env },
  );
  assert.equal(cancel.status, 0, cancel.stderr);
  const payload = JSON.parse(cancel.stdout);
  assert.equal(payload.status, 'completed');
  assert.equal(payload.killed, false);
  assert.match(payload.note, /nothing to cancel/);
});

test('a failed review diff degrades to nonzero without invoking Claude', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const argsFile = path.join(makeTempDir(), 'claude-args.json');
  const env = buildEnv(binDir, { FAKE_CLAUDE_ARGS_FILE: argsFile });

  const result = run(
    process.execPath,
    [COMPANION, 'review', '--cwd', repo, '--base', 'no-such-ref', '--json'],
    { env },
  );

  // Same exit code / ok shape as the malformed-parse degrade: never a
  // confident verdict on a diff that could not be computed.
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.degraded, true);
  assert.equal(payload.kind, 'review');
  assert.equal(fs.existsSync(argsFile), false);
});

test('cancel for an unknown job id reports an error and exits nonzero', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'cancel', '--cwd', repo, 'task-zzz-zzzzzz', '--json'],
    { env },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.kind, 'cancel');
  assert.match(payload.error, /No Claude Code Companion job matching/);
});

test('result with no job and no reference stays a non-error empty response', () => {
  const binDir = makeTempDir();
  installFakeClaude(binDir);
  const repo = tempRepo();
  const env = buildEnv(binDir);

  const result = run(
    process.execPath,
    [COMPANION, 'result', '--cwd', repo, '--json'],
    { env },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.job, null);
  assert.equal(payload.result, null);
});
