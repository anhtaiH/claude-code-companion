#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.join(SCRIPT_DIR, 'claude-companion.mjs');
const TASK_KIND_PROMPTS = {
  diagnose:
    'Diagnose the likely root cause. Use repo context and read-only inspection where helpful.',
  plan: 'Produce a concise implementation and verification plan.',
  research:
    'Research the repository context and report the findings Codex should know.',
  test_gap_review:
    'Find missing or weak tests for the current work. Focus on observable behavior and regression risk.',
  spec_audit:
    'Compare implementation against the supplied spec, task, or acceptance criteria. Call out mismatches.',
  pr_review_prep:
    'Prepare for PR review. Identify likely reviewer questions, unclear decisions, and risky diffs.',
  release_risk:
    'Map release risks, likely regressions, rollback concerns, and practical smoke checks.',
  architecture_critique:
    'Challenge the architecture and design direction. Look for coupling, unclear boundaries, and simpler options.',
  refactor_plan:
    'Plan a safe refactor path with small steps, verification points, and rollback-friendly ordering.',
  log_diagnose:
    'Diagnose the provided logs, stack traces, CI output, or failing command output.',
  dependency_review:
    'Review dependency, framework, or migration changes for compatibility and integration risk.',
  security_review:
    'Review for auth, secrets, privacy, data exposure, unsafe defaults, and permission mistakes.',
};
const REVIEW_KINDS = ['review', 'adversarial_review'];
const TASK_KINDS = Object.keys(TASK_KIND_PROMPTS);
const ALL_KINDS = [...REVIEW_KINDS, ...TASK_KINDS];
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
            'Required for action delegate. Use review/adversarial_review for diff review, or a task kind for diagnosis, planning, research, and focused advisory passes.',
        },
        cwd: {
          type: 'string',
          description:
            'Workspace root. Defaults to the MCP server process working directory.',
        },
        target: {
          type: 'string',
          enum: ['working_tree', 'branch', 'none'],
          description:
            'Delegation target. Use working_tree for uncommitted changes, branch with base for base...HEAD, and none for prompt-only diagnosis, planning, or research.',
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
        timeout_ms: {
          type: 'integer',
          description: 'Optional timeout in milliseconds.',
        },
        max_budget_usd: {
          type: 'number',
          description:
            'Optional Claude Code max-budget-usd guard. No dollar budget is set by default.',
        },
        allow_sensitive_context: {
          type: 'boolean',
          description:
            'Explicitly override default outbound secret-like context blocking. Use only when the user has approved sending that context to Claude.',
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
  pushArg(args, 'timeout-ms', input.timeout_ms);
  pushArg(args, 'max-budget-usd', input.max_budget_usd);
  pushArg(args, 'allow-sensitive-context', input.allow_sensitive_context);
  pushArg(args, 'background', input.background);
}

function pushReviewTargetArgs(args, input = {}) {
  pushArg(args, 'base', input.base);
  if (input.target === 'working_tree') pushArg(args, 'scope', 'working-tree');
  if (input.target === 'branch') pushArg(args, 'scope', 'branch');
  if (input.target === 'none') pushArg(args, 'scope', 'repo');
}

function reviewFocusText(input = {}) {
  const parts = [];
  if (input.prompt) parts.push(String(input.prompt));
  if (input.focus) parts.push(`Focus: ${input.focus}`);
  return parts.join('\n\n');
}

function delegatedTaskPrompt(input = {}) {
  const parts = [];
  if (TASK_KIND_PROMPTS[input.kind]) parts.push(TASK_KIND_PROMPTS[input.kind]);
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
    if (focusText) args.push(focusText);
    return args;
  }

  if (input.kind === 'adversarial_review') {
    const args = [COMPANION, 'adversarial-review', '--json'];
    pushSharedRuntimeArgs(args, input);
    pushReviewTargetArgs(args, input);
    args.push(delegatedTaskPrompt(input) || 'Challenge the current change.');
    return args;
  }

  const args = [COMPANION, 'task', '--json'];
  pushSharedRuntimeArgs(args, input);
  pushArg(args, 'kind', input.kind);
  pushArg(args, 'resume-last', input.resume_last);
  pushArg(args, 'fresh', input.fresh);
  const prompt = delegatedTaskPrompt(input);
  if (prompt) args.push(prompt);
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

function callTool(name, input = {}) {
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
    const result = spawnSync(process.execPath, companionArgs(input), {
      cwd: input.cwd ? path.resolve(input.cwd) : process.cwd(),
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
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
      'Call the single `claude_code` tool with `action: "delegate"`, `kind: "review"`, `target: "working_tree"`, and `background: true` unless the diff is tiny.',
      'Do not set `allow_sensitive_context` unless the user explicitly approves sending secret-like context to Claude.',
      input.focus ? `Focus on: ${input.focus}.` : '',
      'When the job finishes, fetch the result through `claude_code` with `action: "result"`, then present findings by severity and include the Claude session id. Do not edit files until the user asks.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (name === 'claude_adversarial_review') {
    return [
      'Stay in this Codex session and delegate a skeptical, read-only challenge review to Claude Code.',
      'Call the single `claude_code` tool with `action: "delegate"`, `kind: "adversarial_review"`, and `background: true` unless the target is tiny.',
      input.base
        ? `Use target "branch" with base ref ${input.base}.`
        : 'Use target "working_tree" unless the user names a base branch.',
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
      'Call the single `claude_code` tool with `action: "delegate"` and `kind: "diagnose"`.',
      `Problem: ${input.problem ?? '<describe the failing behavior>'}`,
      'Summarize Claude findings, include the session id, and verify before editing.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (name === 'claude_plan') {
    return [
      'Stay in this Codex session and delegate a read-only planning pass to Claude Code.',
      'Call the single `claude_code` tool with `action: "delegate"` and `kind: "plan"`.',
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
rl.on('line', (line) => {
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
        callTool(message.params?.name, message.params?.arguments ?? {}),
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
