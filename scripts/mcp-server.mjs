#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.join(SCRIPT_DIR, 'claude-companion.mjs');

const tools = [
  {
    name: 'consult',
    description:
      'Primary agent-facing handoff to Claude Code. Use this when Codex wants a read-only second-model review, adversarial review, diagnosis, plan, or research pass. It invokes the local Claude Code CLI with no Claude tools by default, returns structured JSON text, and includes a Claude session id or job id when available. Do not use it for edits; use it for independent analysis that Codex will verify before acting.',
    inputSchema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: {
          type: 'string',
          enum: ['review', 'adversarial_review', 'diagnose', 'plan', 'research'],
          description:
            'Type of Claude consultation. Use review for ordinary code review, adversarial_review for skeptical risk review, diagnose for root-cause analysis, plan for implementation planning, and research for read-only investigation.',
        },
        cwd: {
          type: 'string',
          description:
            'Workspace root to inspect. Defaults to the MCP server process working directory.',
        },
        target: {
          type: 'string',
          enum: ['working_tree', 'branch', 'none'],
          description:
            'Review target. Use working_tree for uncommitted changes, branch with base for base...HEAD review, and none for prompt-only diagnosis or planning.',
        },
        base: {
          type: 'string',
          description:
            'Base ref for branch review, for example main. When set for review modes, the companion reviews base...HEAD.',
        },
        prompt: {
          type: 'string',
          description:
            'Task prompt for diagnose, plan, or research modes. For review modes this is optional extra instruction.',
        },
        focus: {
          type: 'string',
          description:
            'Optional focus area, such as security, migrations, API compatibility, data loss, or flaky tests.',
        },
        model: {
          type: 'string',
          description: 'Optional Claude model override passed to Claude Code.',
        },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
          description: 'Optional reasoning effort hint passed to Claude Code.',
        },
        max_budget_usd: {
          type: 'number',
          description:
            'Optional max spend guardrail for this Claude Code call, in US dollars.',
        },
        timeout_ms: {
          type: 'integer',
          description:
            'Optional timeout in milliseconds. Use a larger timeout for background reviews on large diffs.',
        },
        background: {
          type: 'boolean',
          description:
            'When true, start a background job and return immediately with a job id. Use status and result to finish the handoff.',
        },
        resume_last: {
          type: 'boolean',
          description:
            'For diagnose, plan, or research modes, resume the latest completed Claude task session for the same workspace.',
        },
        fresh: {
          type: 'boolean',
          description:
            'For diagnose, plan, or research modes, force a fresh Claude session instead of resuming.',
        },
      },
    },
  },
  {
    name: 'setup',
    description:
      'Check Claude Code Companion readiness for the current workspace. Use this when Claude availability or auth state is unknown. It checks Node, the local claude binary, Claude auth status, and the companion state directory without exposing account details.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description:
            'Workspace root to check. Defaults to the MCP server process working directory.',
        },
      },
    },
  },
  {
    name: 'review',
    description:
      'Low-level read-only Claude Code review of the working tree or branch diff. Prefer consult for ordinary agent use. This tool returns structured review JSON, a Claude session id, and a resume hint; it does not ask Claude to edit files.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description:
            'Workspace root to inspect. Defaults to the MCP server process working directory.',
        },
        base: {
          type: 'string',
          description: 'Base ref for branch review, for example main.',
        },
        scope: {
          type: 'string',
          enum: ['auto', 'working-tree', 'branch'],
          description:
            'Diff target. auto uses branch when base is set, otherwise working-tree.',
        },
        model: {
          type: 'string',
          description: 'Optional Claude model override passed to Claude Code.',
        },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
          description: 'Optional reasoning effort hint passed to Claude Code.',
        },
        max_budget_usd: {
          type: 'number',
          description: 'Optional max spend guardrail in US dollars.',
        },
        timeout_ms: {
          type: 'integer',
          description: 'Optional timeout in milliseconds.',
        },
        background: {
          type: 'boolean',
          description:
            'When true, start a background job and return immediately with a job id.',
        },
      },
    },
  },
  {
    name: 'adversarial_review',
    description:
      'Low-level read-only Claude Code challenge review. Prefer consult for ordinary agent use. Use this for auth, data loss, migrations, rollback, concurrency, hidden coupling, and scope-risk passes.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description:
            'Workspace root to inspect. Defaults to the MCP server process working directory.',
        },
        base: {
          type: 'string',
          description: 'Base ref for branch review, for example main.',
        },
        scope: {
          type: 'string',
          enum: ['auto', 'working-tree', 'branch'],
          description:
            'Diff target. auto uses branch when base is set, otherwise working-tree.',
        },
        focus: {
          type: 'string',
          description:
            'Optional risk area to challenge, such as security, rollback, or data loss.',
        },
        model: {
          type: 'string',
          description: 'Optional Claude model override passed to Claude Code.',
        },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
          description: 'Optional reasoning effort hint passed to Claude Code.',
        },
        max_budget_usd: {
          type: 'number',
          description: 'Optional max spend guardrail in US dollars.',
        },
        timeout_ms: {
          type: 'integer',
          description: 'Optional timeout in milliseconds.',
        },
        background: {
          type: 'boolean',
          description:
            'When true, start a background job and return immediately with a job id.',
        },
      },
    },
  },
  {
    name: 'task',
    description:
      'Low-level read-only Claude Code task for diagnosis, planning, or research. Prefer consult for ordinary agent use. This sends a prompt to Claude without write tools and returns raw output plus session metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description:
            'Workspace root to inspect. Defaults to the MCP server process working directory.',
        },
        prompt: {
          type: 'string',
          description:
            'The diagnosis, planning, or research question for Claude.',
        },
        resume_last: {
          type: 'boolean',
          description:
            'Resume the latest completed Claude task session for this workspace.',
        },
        fresh: {
          type: 'boolean',
          description: 'Force a fresh Claude session instead of resuming.',
        },
        model: {
          type: 'string',
          description: 'Optional Claude model override passed to Claude Code.',
        },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
          description: 'Optional reasoning effort hint passed to Claude Code.',
        },
        max_budget_usd: {
          type: 'number',
          description: 'Optional max spend guardrail in US dollars.',
        },
        timeout_ms: {
          type: 'integer',
          description: 'Optional timeout in milliseconds.',
        },
        background: {
          type: 'boolean',
          description:
            'When true, start a background job and return immediately with a job id.',
        },
      },
    },
  },
  {
    name: 'status',
    description:
      'List running and recent Claude Code Companion jobs for a workspace. Use after consult, review, adversarial_review, or task returns a background job id.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description:
            'Workspace root whose job board should be inspected. Defaults to the MCP server process working directory.',
        },
        job_id: {
          type: 'string',
          description: 'Optional specific job id to inspect.',
        },
        all: {
          type: 'boolean',
          description:
            'When true, include older jobs instead of only active and recent jobs.',
        },
      },
    },
  },
  {
    name: 'result',
    description:
      'Return a stored Claude Code Companion job result, raw Claude JSON, parsed review data, logs, and the claude -r resume hint when available.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description:
            'Workspace root whose job board should be inspected. Defaults to the MCP server process working directory.',
        },
        job_id: {
          type: 'string',
          description: 'Job id returned by a background call.',
        },
      },
    },
  },
  {
    name: 'cancel',
    description:
      'Cancel a running Claude Code Companion background job and mark it cancelled in the local job board.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description:
            'Workspace root whose job board should be inspected. Defaults to the MCP server process working directory.',
        },
        job_id: {
          type: 'string',
          description: 'Job id returned by a background call.',
        },
      },
    },
  },
];

const prompts = [
  {
    name: 'review_current_diff',
    title: 'Claude review current diff',
    description:
      'Ask Claude Code Companion to run a read-only second-model review of the current working tree.',
    arguments: [
      {
        name: 'max_budget_usd',
        description: 'Optional budget guardrail, for example 0.25.',
        required: false,
      },
      {
        name: 'focus',
        description: 'Optional review focus, such as API compatibility.',
        required: false,
      },
    ],
  },
  {
    name: 'adversarial_review',
    title: 'Claude adversarial review',
    description:
      'Ask Claude Code Companion to challenge assumptions and risk in the current diff or branch.',
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
      {
        name: 'max_budget_usd',
        description: 'Optional budget guardrail, for example 0.35.',
        required: false,
      },
    ],
  },
  {
    name: 'diagnose_with_claude',
    title: 'Claude diagnosis',
    description:
      'Ask Claude Code Companion for read-only root-cause analysis of a bug, failing test, or confusing behavior.',
    arguments: [
      {
        name: 'problem',
        description: 'The bug, symptom, or failing command to diagnose.',
        required: true,
      },
      {
        name: 'max_budget_usd',
        description: 'Optional budget guardrail, for example 0.20.',
        required: false,
      },
    ],
  },
  {
    name: 'plan_with_claude',
    title: 'Claude planning pass',
    description:
      'Ask Claude Code Companion for a read-only implementation or verification plan before Codex edits.',
    arguments: [
      {
        name: 'goal',
        description: 'The implementation, migration, or verification goal.',
        required: true,
      },
      {
        name: 'max_budget_usd',
        description: 'Optional budget guardrail, for example 0.20.',
        required: false,
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

function commandForConsult(input = {}) {
  if (input.mode === 'adversarial_review') return 'adversarial-review';
  if (input.mode === 'diagnose' || input.mode === 'plan' || input.mode === 'research')
    return 'task';
  return 'review';
}

function consultPrompt(input = {}) {
  const parts = [];
  if (input.prompt) parts.push(String(input.prompt));
  if (input.focus) parts.push(`Focus: ${input.focus}`);
  if (!parts.length && input.mode === 'plan')
    parts.push('Produce a concise read-only implementation and verification plan.');
  if (!parts.length && input.mode === 'diagnose')
    parts.push('Diagnose the likely root cause. Do not suggest edits.');
  if (!parts.length && input.mode === 'research')
    parts.push('Research the repository context and report useful findings. Do not edit.');
  return parts.join('\n\n');
}

function pushTargetArgs(args, input = {}) {
  if (input.target === 'working_tree') pushArg(args, 'scope', 'working-tree');
  else if (input.target === 'branch') pushArg(args, 'scope', 'branch');
}

function companionArgs(name, input = {}) {
  const command =
    name === 'consult'
      ? commandForConsult(input)
      : name === 'adversarial_review'
        ? 'adversarial-review'
        : name;
  const args = [COMPANION, command, '--json'];
  pushArg(args, 'cwd', input.cwd);
  pushArg(args, 'base', input.base);
  pushArg(args, 'scope', input.scope);
  if (name === 'consult') pushTargetArgs(args, input);
  pushArg(args, 'model', input.model);
  pushArg(args, 'effort', input.effort);
  pushArg(args, 'max-budget-usd', input.max_budget_usd);
  pushArg(args, 'timeout-ms', input.timeout_ms);
  pushArg(args, 'background', input.background);
  pushArg(args, 'resume-last', input.resume_last);
  pushArg(args, 'fresh', input.fresh);
  pushArg(args, 'all', input.all);
  const jobId = input.job_id;
  if (jobId && ['status', 'result', 'cancel'].includes(command))
    args.push(jobId);
  if (command === 'adversarial-review')
    args.push(consultPrompt(input) || 'Challenge the current change.');
  if (command === 'task') {
    const prompt = name === 'consult' ? consultPrompt(input) : input.prompt;
    if (prompt) args.push(prompt);
  }
  return args;
}

function callTool(name, input = {}) {
  const result = spawnSync(process.execPath, companionArgs(name, input), {
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
  if (name === 'review_current_diff') {
    return [
      'Use Claude Code Companion as the read-only second-model reviewer for this workspace.',
      'Call the `consult` tool with `mode: "review"`, `target: "working_tree"`, and `background: true` unless the diff is tiny.',
      input.max_budget_usd
        ? `Use max_budget_usd ${input.max_budget_usd}.`
        : 'Use a small explicit max_budget_usd if the user did not provide one.',
      input.focus ? `Focus on: ${input.focus}.` : '',
      'When the job completes, present findings first by severity and include the Claude session id or resume hint. Do not edit files until the user asks.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (name === 'adversarial_review') {
    return [
      'Use Claude Code Companion for a skeptical, read-only challenge review.',
      'Call `consult` with `mode: "adversarial_review"` and `background: true` unless the target is tiny.',
      input.base
        ? `Review the branch against base ref ${input.base}.`
        : 'Review the current working tree unless the user names a base branch.',
      input.max_budget_usd
        ? `Use max_budget_usd ${input.max_budget_usd}.`
        : 'Use a small explicit max_budget_usd if the user did not provide one.',
      input.focus
        ? `Challenge this focus area: ${input.focus}.`
        : 'Focus on hidden assumptions, rollback, data loss, auth, concurrency, and scope risk.',
      'Return only actionable findings and stop before fixing anything.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (name === 'diagnose_with_claude') {
    return [
      'Use Claude Code Companion for read-only root-cause diagnosis.',
      'Call `consult` with `mode: "diagnose"` and a prompt that includes the problem statement below.',
      input.max_budget_usd
        ? `Use max_budget_usd ${input.max_budget_usd}.`
        : 'Use a small explicit max_budget_usd if the user did not provide one.',
      `Problem: ${input.problem ?? '<describe the failing behavior>'}`,
      'Summarize Claude findings, include the session id, and verify before editing.',
    ].join('\n');
  }
  if (name === 'plan_with_claude') {
    return [
      'Use Claude Code Companion for a read-only planning pass before implementation.',
      'Call `consult` with `mode: "plan"` and a prompt that includes the goal below.',
      input.max_budget_usd
        ? `Use max_budget_usd ${input.max_budget_usd}.`
        : 'Use a small explicit max_budget_usd if the user did not provide one.',
      `Goal: ${input.goal ?? '<describe the implementation or verification goal>'}`,
      'Use the plan as advisory input. Codex owns the final implementation and verification.',
    ].join('\n');
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
        serverInfo: { name: 'claude-code-companion', version: '0.1.0' },
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
