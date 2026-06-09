import fs from 'node:fs';
import path from 'node:path';
import { runSync } from './process.mjs';

const MAX_CONTEXT_CHARS = 6000;
const MAX_DIFF_CHARS = 24000;
const MAX_UNTRACKED_FILES = 8;
const MAX_UNTRACKED_CHARS = 4000;
// Hard byte cap when reading an untracked file for context and secret
// scanning. Far above the prompt budget, low enough that a stray multi-GB
// artifact cannot balloon companion memory.
const MAX_UNTRACKED_READ_BYTES = 5 * 1024 * 1024;

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

function refExists(cwd, ref) {
  return runGit(cwd, ['rev-parse', '--verify', '--quiet', ref]).ok;
}

// Resolve the base branch for a `branch` scoped review from refs that actually
// exist, instead of assuming `main`. A repo on `master`/`develop` would
// otherwise diff against a nonexistent `main`, review nothing, and still emit a
// confident verdict. Returns null when no conventional base can be found so the
// caller can fail loudly rather than silently review an empty diff.
function resolveDefaultBaseRef(cwd) {
  const originHead = runGit(cwd, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  if (originHead.ok) {
    const ref = originHead.stdout.trim();
    if (ref && refExists(cwd, ref)) return ref;
  }
  for (const candidate of ['main', 'master', 'develop', 'trunk']) {
    if (refExists(cwd, candidate)) return candidate;
  }
  return null;
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
  if (scope === 'repo' || scope === 'repository') {
    return {
      mode: 'repo',
      label: 'repository review',
      diffArgs: null,
      shortstatArgs: null,
    };
  }

  if (scope === 'branch') {
    const baseRef = resolveDefaultBaseRef(cwd);
    if (!baseRef) {
      throw new Error(
        'Could not resolve a base branch for branch review (looked for origin/HEAD, main, master, develop, trunk). Pass --base <ref> explicitly.',
      );
    }
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
      'Unsupported review scope. Use auto, working-tree, repo, or pass --base <ref>.',
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
  // lstat (not stat): an untracked symlink may point outside the repo, and
  // following it would send unrelated file contents to Claude.
  let stat;
  try {
    stat = fs.lstatSync(fullPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const readBytes = Math.min(stat.size, MAX_UNTRACKED_READ_BYTES);
  const buffer = Buffer.alloc(readBytes);
  let bytesRead = 0;
  const fd = fs.openSync(fullPath, 'r');
  try {
    bytesRead = fs.readSync(fd, buffer, 0, readBytes, 0);
  } finally {
    fs.closeSync(fd);
  }
  const content = buffer.subarray(0, bytesRead);
  if (content.includes(0)) return null;
  const text = content.toString('utf8');
  return stat.size > readBytes
    ? `${text}\n[truncated ${stat.size - readBytes} bytes]`
    : text;
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
      // The listing failed; `names: []` here does NOT mean "no untracked files".
      // Callers that treat empty as "nothing to review" must not short-circuit.
      listed: false,
    };
  const names = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (!names.length)
    return { names, entries: [], rendered: 'None.', listed: true };

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
  return { names, entries, rendered: rendered.join('\n\n'), listed: true };
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
  const diffResult = target.diffArgs
    ? runGit(repoRoot, target.diffArgs)
    : { ok: true, stdout: '', stderr: '' };
  const rawDiff = diffResult.stdout || '';
  const shortstat = target.shortstatArgs
    ? (() => {
        const result = runGit(repoRoot, target.shortstatArgs);
        if (!result.ok)
          return `Unable to compute diff shortstat: ${
            result.stderr || 'git diff --shortstat failed'
          }`;
        return result.stdout.trim() || 'No tracked diff.';
      })()
    : 'Repository review requested; no diff target.';
  const status =
    runGit(repoRoot, [
      'status',
      '--short',
      '--untracked-files=all',
    ]).stdout.trim() || 'Clean.';
  const untracked =
    target.mode === 'working-tree'
      ? collectUntracked(repoRoot)
      : {
          names: [],
          entries: [],
          rendered:
            target.mode === 'repo'
              ? 'Not included for repository review.'
              : 'Not included for branch review.',
        };

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
      diffResult.ok
        ? null
        : `Diff error: ${diffResult.stderr || 'git diff failed'}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
