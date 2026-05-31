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
    name: 'setup',
    description:
      'Check Claude Code Companion readiness for the current workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
      },
    },
  },
  {
    name: 'review',
    description:
      'Run a read-only Claude Code review of the working tree or branch diff.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        base: { type: 'string' },
        scope: { type: 'string', enum: ['auto', 'working-tree', 'branch'] },
        model: { type: 'string' },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        max_budget_usd: { type: 'number' },
        timeout_ms: { type: 'integer' },
        background: { type: 'boolean' },
      },
    },
  },
  {
    name: 'adversarial_review',
    description:
      'Run a read-only Claude Code review that challenges design and implementation assumptions.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        base: { type: 'string' },
        scope: { type: 'string', enum: ['auto', 'working-tree', 'branch'] },
        focus: { type: 'string' },
        model: { type: 'string' },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        max_budget_usd: { type: 'number' },
        timeout_ms: { type: 'integer' },
        background: { type: 'boolean' },
      },
    },
  },
  {
    name: 'task',
    description:
      'Ask Claude Code for read-only diagnosis, planning, or research.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        prompt: { type: 'string' },
        resume_last: { type: 'boolean' },
        fresh: { type: 'boolean' },
        model: { type: 'string' },
        effort: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        max_budget_usd: { type: 'number' },
        timeout_ms: { type: 'integer' },
        background: { type: 'boolean' },
      },
    },
  },
  {
    name: 'status',
    description: 'List running and recent Claude Code Companion jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        job_id: { type: 'string' },
        all: { type: 'boolean' },
      },
    },
  },
  {
    name: 'result',
    description: 'Show a stored Claude Code Companion job result.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        job_id: { type: 'string' },
      },
    },
  },
  {
    name: 'cancel',
    description: 'Cancel a running Claude Code Companion background job.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        job_id: { type: 'string' },
      },
    },
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

function companionArgs(name, input = {}) {
  const command = name === 'adversarial_review' ? 'adversarial-review' : name;
  const args = [COMPANION, command, '--json'];
  pushArg(args, 'cwd', input.cwd);
  pushArg(args, 'base', input.base);
  pushArg(args, 'scope', input.scope);
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
  if (command === 'adversarial-review' && input.focus) args.push(input.focus);
  if (command === 'task' && input.prompt) args.push(input.prompt);
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

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      respond(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'claude-code-companion', version: '0.1.0' },
      });
    } else if (message.method === 'tools/list') {
      respond(message.id, { tools });
    } else if (message.method === 'tools/call') {
      respond(
        message.id,
        callTool(message.params?.name, message.params?.arguments ?? {}),
      );
    } else if (message.id) {
      respond(message.id, {});
    }
  } catch (error) {
    respondError(null, error instanceof Error ? error.message : String(error));
  }
});
