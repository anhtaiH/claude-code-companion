import fs from 'node:fs';
import path from 'node:path';
import { runSync } from './process.mjs';

const MAX_CONTEXT_CHARS = 6000;
const MAX_DIFF_CHARS = 24000;
const MAX_UNTRACKED_FILES = 8;
const MAX_UNTRACKED_CHARS = 4000;

function trimText(text, limit = MAX_CONTEXT_CHARS) {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`;
}

function runGit(cwd, args) {
  return runSync('git', args, { cwd });
}

export function resolveWorkspaceRoot(cwd = process.cwd()) {
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.ok && result.stdout.trim()) return result.stdout.trim();
  return path.resolve(cwd);
}

export function ensureGitRepository(cwd = process.cwd()) {
  const result = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!result.ok || result.stdout.trim() !== 'true') {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

export function resolveReviewTarget(cwd, options = {}) {
  ensureGitRepository(cwd);
  if (options.base) {
    return {
      mode: 'branch',
      baseRef: String(options.base),
      label: `changes against ${options.base}`,
      diffArgs: ['diff', `${options.base}...HEAD`],
      shortstatArgs: ['diff', '--shortstat', `${options.base}...HEAD`],
    };
  }

  const scope = options.scope ?? 'auto';
  if (scope === 'branch') {
    const baseRef = 'main';
    return {
      mode: 'branch',
      baseRef,
      label: `changes against ${baseRef}`,
      diffArgs: ['diff', `${baseRef}...HEAD`],
      shortstatArgs: ['diff', '--shortstat', `${baseRef}...HEAD`],
    };
  }

  if (!['auto', 'working-tree'].includes(scope)) {
    throw new Error(
      'Unsupported review scope. Use auto, working-tree, or pass --base <ref>.',
    );
  }

  return {
    mode: 'working-tree',
    label: 'working tree changes',
    diffArgs: ['diff', 'HEAD'],
    shortstatArgs: ['diff', '--shortstat', 'HEAD'],
  };
}

function safeReadRelative(repoRoot, relPath) {
  const fullPath = path.resolve(repoRoot, relPath);
  const root = path.resolve(repoRoot);
  if (!fullPath.startsWith(`${root}${path.sep}`)) return null;
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  const buffer = fs.readFileSync(fullPath);
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8');
}

function collectUntracked(repoRoot) {
  const result = runGit(repoRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  if (!result.ok)
    return {
      names: [],
      entries: [],
      rendered: 'Unable to list untracked files.',
    };
  const names = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (!names.length) return { names, entries: [], rendered: 'None.' };

  const entries = [];
  const rendered = [];
  for (const name of names.slice(0, MAX_UNTRACKED_FILES)) {
    const content = safeReadRelative(repoRoot, name);
    entries.push({ path: name, content });
    rendered.push(`### ${name}`);
    rendered.push(
      content == null
        ? '(binary, missing, or unreadable)'
        : ['```', trimText(content, MAX_UNTRACKED_CHARS), '```'].join('\n'),
    );
  }
  if (names.length > MAX_UNTRACKED_FILES) {
    rendered.push(
      `... ${names.length - MAX_UNTRACKED_FILES} more untracked file(s) omitted.`,
    );
  }
  return { names, entries, rendered: rendered.join('\n\n') };
}

function readRepoFile(repoRoot, relPath) {
  const fullPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  return `## ${relPath}\n\n${trimText(fs.readFileSync(fullPath, 'utf8'))}`;
}

export function collectRepoInstructions(repoRoot) {
  const candidates = ['AGENTS.md', 'CLAUDE.md', 'README.md'];
  const blocks = candidates
    .map((file) => readRepoFile(repoRoot, file))
    .filter(Boolean);
  return blocks.length
    ? blocks.join('\n\n')
    : 'No AGENTS.md, CLAUDE.md, or README.md context found.';
}

export function collectReviewContext(cwd, target) {
  const repoRoot = resolveWorkspaceRoot(cwd);
  const branch =
    runGit(repoRoot, ['branch', '--show-current']).stdout.trim() ||
    '(detached)';
  const diffResult = runGit(repoRoot, target.diffArgs);
  const rawDiff = diffResult.stdout || '';
  const shortstat =
    runGit(repoRoot, target.shortstatArgs).stdout.trim() || 'No tracked diff.';
  const status =
    runGit(repoRoot, [
      'status',
      '--short',
      '--untracked-files=all',
    ]).stdout.trim() || 'Clean.';
  const untracked =
    target.mode === 'working-tree'
      ? collectUntracked(repoRoot)
      : { names: [], entries: [], rendered: 'Not included for branch review.' };

  return {
    repoRoot,
    branch,
    target,
    status,
    shortstat,
    diff: trimText(rawDiff, MAX_DIFF_CHARS),
    diffScanText: rawDiff,
    diffError: diffResult.ok ? null : diffResult.stderr || 'git diff failed',
    untracked,
    repoContext: collectRepoInstructions(repoRoot),
    gitContext: [
      `Branch: ${branch}`,
      `Status:\n${status}`,
      `Shortstat: ${shortstat}`,
    ].join('\n\n'),
  };
}
