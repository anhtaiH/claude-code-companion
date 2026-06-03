#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ALL_KINDS } from './lib/kinds.mjs';
import { terminateProcessTree } from './lib/process.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.join(SCRIPT_DIR, 'claude-companion.mjs');
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');
const DANGEROUS_INPUT_KEYS = [
  'write',
  'edit',
  'dangerously_skip_permissions',
  'dangerously-skip-permissions',
  'allow_dangerously_skip_permissions',
  'allow-dangerously-skip-permissions',
  'permission_mode',
  'permission-mode',
];

const tools = [
  {
    name: 'claude_code',
    description: [
      'The single agent-native Claude Code Companion API. Use this from inside Codex to delegate read-only review, adversarial review, diagnosis, planning, or research to the local Claude Code CLI, then return the result to the Codex agent. Also use this same tool to check setup, inspect status, fetch results, or cancel a background delegation. Do not call shell commands directly for normal use.',
      'Delegations default to Opus 4.8 1M, max effort, Ultracode dynamic workflows, and read-only Claude subagents.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['setup', 'delegate', 'status', 'result', 'cancel'],
          description:
            'Use setup to check readiness, delegate to start Claude work, status to inspect jobs, result to fetch a completed job, and cancel to stop a running job.',
        },
        kind: {
          type: 'string',
          enum: ALL_KINDS,
          description:
            'Required for action delegate. Use review or adversarial_review for diff review, or diagnose, plan, or research for prompt-driven work. For specialist angles (security, tests, release risk, architecture, logs, dependencies, spec, PR prep) pass the focus argument rather than a separate kind.',
        },
        cwd: {
          type: 'string',
          description:
            'Absolute workspace root. Codex agents should pass this on every action; if omitted, the server infers it from the active session environment.',
        },
        target: {
          type: 'string',
          enum: ['working_tree', 'branch', 'repo'],
          description:
            'Review target. Use working_tree for uncommitted changes, branch with base for base...HEAD, or repo for full-repository review. Omit target for diagnosis, planning, research, and other prompt-only tasks.',
        },
        base: {
          type: 'string',
          description: 'Base ref for branch review, for example main.',
        },
        prompt: {
          type: 'string',
          description:
            'Natural-language task to delegate to Claude. Required for diagnose, plan, and research unless the kind itself is enough.',
        },
        focus: {
          type: 'string',
          description:
            'Optional risk or topic focus, such as auth, rollback, data loss, API compatibility, or flaky tests.',
        },
        model: {
          type: 'string',
          description:
            'Optional Claude model override passed to Claude Code. Defaults to opus[1m].',
        },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
          description:
            'Optional reasoning effort override passed to Claude Code. Defaults to max.',
        },
        cost_preset: {
          type: 'string',
          enum: ['cheap'],
          description:
            'Optional cost preset for cheap probe or smoke calls. "cheap" uses a smaller model and low effort; an explicit model or effort overrides it. Substantive work should omit this and keep the opus[1m]/max default.',
        },
        timeout_ms: {
          type: 'integer',
          description: 'Optional timeout in milliseconds.',
        },
        max_budget_usd: {
          type: 'number',
          description:
            'Optional Claude Code max-budget-usd guard. No dollar budget is set by default.',
        },
        strict_sensitive_context: {
          type: 'boolean',
          description:
            'Block before calling Claude when heuristic secret-like context is detected. Off by default to keep delegation low-friction.',
        },
        background: {
          type: 'boolean',
          description:
            'When true, start Claude work in the background and return a job id. Use action status and result through this same tool.',
        },
        resume_last: {
          type: 'boolean',
          description:
            'For diagnose, plan, or research delegations, resume the latest completed Claude task session for this workspace.',
        },
        fresh: {
          type: 'boolean',
          description:
            'For diagnose, plan, or research delegations, force a fresh Claude session.',
        },
        job_id: {
          type: 'string',
          description:
            'Background job id for action status, result, or cancel. Omit for a workspace-level status summary.',
        },
        all: {
          type: 'boolean',
          description: 'For action status, include older jobs as well.',
        },
      },
    },
  },
];

const prompts = [
  {
    name: 'claude_review',
    title: 'Claude review',
    description:
      'Delegate a read-only second-model review of the current work to Claude Code.',
    arguments: [
      {
        name: 'focus',
        description: 'Optional review focus, such as API compatibility.',
        required: false,
      },
    ],
  },
  {
    name: 'claude_adversarial_review',
    title: 'Claude adversarial review',
    description:
      'Delegate a skeptical risk review to Claude Code without leaving Codex.',
    arguments: [
      {
        name: 'focus',
        description: 'Risk focus, such as auth, data loss, or rollback.',
        required: false,
      },
      {
        name: 'base',
        description: 'Optional base ref for branch review, for example main.',
        required: false,
      },
    ],
  },
  {
    name: 'claude_diagnose',
    title: 'Claude diagnosis',
    description:
      'Delegate read-only root-cause analysis to Claude Code and return to Codex.',
    arguments: [
      {
        name: 'problem',
        description: 'The bug, symptom, or failing command to diagnose.',
        required: true,
      },
    ],
  },
  {
    name: 'claude_plan',
    title: 'Claude planning pass',
    description:
      'Delegate read-only planning to Claude Code before Codex implements.',
    arguments: [
      {
        name: 'goal',
        description: 'The implementation, migration, or verification goal.',
        required: true,
      },
    ],
  },
];

function pushArg(args, name, value) {
  if (value === undefined || value === null || value === false) return;
  if (value === true) {
    args.push(`--${name}`);
    return;
  }
  args.push(`--${name}`, String(value));
}

function gitRoot(candidate) {
  if (!candidate) return null;
  const result = spawnSync(
    'git',
    ['-C', path.resolve(candidate), 'rev-parse', '--show-toplevel'],
    { encoding: 'utf8' },
  );
  if ((result.status ?? 1) !== 0) return null;
  return result.stdout.trim() ? path.resolve(result.stdout.trim()) : null;
}

function inferWorkspaceCwd(input = {}) {
  if (input.cwd) return path.resolve(input.cwd);
  const candidates = [
    process.env.CODEX_WORKSPACE_ROOT,
    process.env.CODEX_PROJECT_DIR,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.PWD,
    process.cwd(),
  ];
  for (const candidate of candidates) {
    const root = gitRoot(candidate);
    if (root && root !== PLUGIN_ROOT) return root;
  }
  return process.cwd();
}

function withResolvedCwd(input = {}) {
  return {
    ...input,
    cwd: inferWorkspaceCwd(input),
  };
}

function rejectDangerousInput(input = {}) {
  const found = DANGEROUS_INPUT_KEYS.filter((key) =>
    Object.hasOwn(input, key),
  );
  if (found.length) {
    throw new Error(
      `Claude Code Companion is read-only; refusing MCP input(s): ${found.join(', ')}`,
    );
  }
}

function pushSharedRuntimeArgs(args, input = {}) {
  pushArg(args, 'cwd', input.cwd);
  pushArg(args, 'model', input.model);
  pushArg(args, 'effort', input.effort);
  pushArg(args, 'cost-preset', input.cost_preset);
  pushArg(args, 'timeout-ms', input.timeout_ms);
  pushArg(args, 'max-budget-usd', input.max_budget_usd);
  pushArg(args, 'strict-sensitive-context', input.strict_sensitive_context);
  pushArg(args, 'background', input.background);
}

function pushReviewTargetArgs(args, input = {}) {
  if (input.target === 'none') {
    throw new Error(
      'Review delegations do not use target "none"; use target "repo" for full-repository review or target "working_tree" for current changes.',
    );
  }
  pushArg(args, 'base', input.base);
  if (input.target === 'working_tree') pushArg(args, 'scope', 'working-tree');
  if (input.target === 'branch') pushArg(args, 'scope', 'branch');
  if (input.target === 'repo') pushArg(args, 'scope', 'repo');
}

function reviewFocusText(input = {}) {
  const parts = [];
  if (input.prompt) parts.push(String(input.prompt));
  if (input.focus) parts.push(`Focus: ${input.focus}`);
  return parts.join('\n\n');
}

function delegatedTaskPrompt(input = {}) {
  // Per-kind guidance is injected once, by the companion's "## Work Mode"
  // section (derived from lib/kinds.mjs). This server only forwards the user's
  // request and focus so the kind prompt is never double-injected.
  const parts = [];
  if (input.prompt) parts.push(`Request: ${String(input.prompt)}`);
  if (input.focus) parts.push(`Focus: ${input.focus}`);
  if (!parts.length)
    parts.push('Inspect the repository context and report useful findings.');
  return parts.join('\n\n');
}

function delegateArgs(input = {}) {
  if (!input.kind) {
    throw new Error('action delegate requires kind');
  }

  if (input.kind === 'review') {
    const args = [COMPANION, 'review', '--json'];
    pushSharedRuntimeArgs(args, input);
    pushReviewTargetArgs(args, input);
    const focusText = reviewFocusText(input);
    if (focusText) args.push('--', focusText);
    return args;
  }

  if (input.kind === 'adversarial_review') {
    const args = [COMPANION, 'adversarial-review', '--json'];
    pushSharedRuntimeArgs(args, input);
    pushReviewTargetArgs(args, input);
    args.push(
      '--',
      delegatedTaskPrompt(input) || 'Challenge the current change.',
    );
    return args;
  }

  const args = [COMPANION, 'task', '--json'];
  pushSharedRuntimeArgs(args, input);
  pushArg(args, 'kind', input.kind);
  pushArg(args, 'resume-last', input.resume_last);
  pushArg(args, 'fresh', input.fresh);
  const prompt = delegatedTaskPrompt(input);
  if (prompt) args.push('--', prompt);
  return args;
}

function companionArgs(input = {}) {
  rejectDangerousInput(input);

  if (input.action === 'setup') {
    const args = [COMPANION, 'setup', '--json'];
    pushArg(args, 'cwd', input.cwd);
    return args;
  }

  if (input.action === 'delegate') {
    return delegateArgs(input);
  }

  if (['status', 'result', 'cancel'].includes(input.action)) {
    const args = [COMPANION, input.action, '--json'];
    pushArg(args, 'cwd', input.cwd);
    pushArg(args, 'all', input.all);
    if (input.job_id) args.push(input.job_id);
    return args;
  }

  throw new Error(
    'claude_code action must be setup, delegate, status, result, or cancel',
  );
}

// In-flight companion children, so a server shutdown can reap them (and the
// Claude grandchild) instead of leaving an orphaned foreground job billing.
const activeChildren = new Set();

function killActiveChildren() {
  for (const child of activeChildren) {
    if (child.pid) terminateProcessTree(child.pid);
  }
  activeChildren.clear();
}

function runCompanion(args, cwd) {
  return new Promise((resolve) => {
    // Detached so the companion leads its own process group; terminating that
    // group on shutdown reaps both the companion and its `claude` child.
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      activeChildren.delete(child);
      resolve(result);
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      finish({ status: 1, stdout, stderr: error.message || stderr });
    });
    child.on('close', (status) => {
      finish({ status: status ?? 1, stdout, stderr });
    });
  });
}

// Reap in-flight children when the server is asked to terminate. Driven by
// signals only: stdin EOF must drain pending responses (the readline loop is
// in-flight-aware), so it is deliberately not used as a kill trigger.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    killActiveChildren();
    process.exit(0);
  });
}

async function callTool(name, input = {}) {
  if (name !== 'claude_code') {
    return {
      content: [
        {
          type: 'text',
          text: 'Unknown tool. Use the single claude_code tool.',
        },
      ],
      isError: true,
    };
  }

  try {
    const resolvedInput = withResolvedCwd(input);
    const result = await runCompanion(
      companionArgs(resolvedInput),
      resolvedInput.cwd,
    );
    const text = (result.stdout || result.stderr || '').trim();
    return {
      content: [{ type: 'text', text }],
      isError: (result.status ?? 1) !== 0,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    };
  }
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function respondError(id, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } })}\n`,
  );
}

function promptText(name, input = {}) {
  if (name === 'claude_review') {
    return [
      'Stay in this Codex session and delegate a read-only second-model review to Claude Code.',
      'Call the single `claude_code` tool with `action: "delegate"`, the active workspace `cwd`, `kind: "review"`, `target: "working_tree"`, and `background: true` unless the diff is tiny.',
      'For a full-repository review, use `target: "repo"`.',
      'Leave `strict_sensitive_context` unset unless the user explicitly wants heuristic secret-like context to block the run.',
      input.focus ? `Focus on: ${input.focus}.` : '',
      'When the job finishes, fetch the result through `claude_code` with `action: "result"`, then present findings by severity and include the Claude session id. Do not edit files until the user asks.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (name === 'claude_adversarial_review') {
    return [
      'Stay in this Codex session and delegate a skeptical, read-only challenge review to Claude Code.',
      'Call the single `claude_code` tool with `action: "delegate"`, the active workspace `cwd`, `kind: "adversarial_review"`, and `background: true` unless the target is tiny.',
      input.base
        ? `Use target "branch" with base ref ${input.base}.`
        : 'Use target "working_tree" unless the user names a base branch.',
      'For a full-repository adversarial review, use target "repo".',
      input.focus
        ? `Challenge this focus area: ${input.focus}.`
        : 'Focus on hidden assumptions, rollback, data loss, auth, concurrency, and scope risk.',
      'Return only actionable findings and stop before fixing anything.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (name === 'claude_diagnose') {
    return [
      'Stay in this Codex session and delegate read-only diagnosis to Claude Code.',
      'Call the single `claude_code` tool with `action: "delegate"`, the active workspace `cwd`, and `kind: "diagnose"`.',
      `Problem: ${input.problem ?? '<describe the failing behavior>'}`,
      'Summarize Claude findings, include the session id, and verify before editing.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (name === 'claude_plan') {
    return [
      'Stay in this Codex session and delegate a read-only planning pass to Claude Code.',
      'Call the single `claude_code` tool with `action: "delegate"`, the active workspace `cwd`, and `kind: "plan"`.',
      `Goal: ${input.goal ?? '<describe the implementation or verification goal>'}`,
      'Use the plan as advisory input. Codex owns the final implementation and verification.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  throw new Error(`Unknown prompt: ${name}`);
}

function getPrompt(name, input = {}) {
  const prompt = prompts.find((candidate) => candidate.name === name);
  if (!prompt) throw new Error(`Unknown prompt: ${name}`);
  return {
    description: prompt.description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: promptText(name, input),
        },
      },
    ],
  };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      respond(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'claude', version: '1.0.0' },
      });
    } else if (message.method === 'tools/list') {
      respond(message.id, { tools });
    } else if (message.method === 'tools/call') {
      respond(
        message.id,
        await callTool(message.params?.name, message.params?.arguments ?? {}),
      );
    } else if (message.method === 'prompts/list') {
      respond(message.id, { prompts });
    } else if (message.method === 'prompts/get') {
      respond(
        message.id,
        getPrompt(message.params?.name, message.params?.arguments ?? {}),
      );
    } else if (message.id) {
      respond(message.id, {});
    }
  } catch (error) {
    respondError(null, error instanceof Error ? error.message : String(error));
  }
});
