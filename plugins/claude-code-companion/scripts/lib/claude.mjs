import fs from 'node:fs';
import { binaryAvailable, runSync } from './process.mjs';

const SECRET_PATTERN =
  /(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|password\s*=|secret\s*=|token\s*=)/i;
const READ_ONLY_TOOLS = 'Read,Glob,Grep,Bash';
const READ_ONLY_ALLOWED_TOOLS =
  'Read,Glob,Grep,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*)';
const WRITE_TOOLS = /\b(?:Edit|Write)\b/;

export function hasSecretLikeText(value) {
  return SECRET_PATTERN.test(String(value ?? ''));
}

export function getClaudeAvailability(cwd) {
  return binaryAvailable('claude', ['--version'], { cwd });
}

export function getClaudeAuthStatus(cwd) {
  const result = runSync('claude', ['auth', 'status'], { cwd });
  if (!result.ok) {
    return {
      loggedIn: false,
      detail:
        result.stderr.trim() ||
        result.stdout.trim() ||
        'claude auth status failed',
      rawStatus: result.status,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return {
      loggedIn: Boolean(parsed.loggedIn),
      detail: parsed.loggedIn
        ? `logged in via ${parsed.authMethod ?? parsed.apiProvider ?? 'unknown'}`
        : 'not logged in',
      authMethod: parsed.authMethod ?? null,
      apiProvider: parsed.apiProvider ?? null,
      subscriptionType: parsed.subscriptionType ?? null,
      rawStatus: result.status,
    };
  } catch {
    return {
      loggedIn: false,
      detail: 'claude auth status returned invalid JSON',
      rawStatus: result.status,
    };
  }
}

function normalizeEffort(effort) {
  if (!effort) return null;
  const value = String(effort).trim().toLowerCase();
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(value)) {
    throw new Error(
      'Unsupported effort. Use low, medium, high, xhigh, or max.',
    );
  }
  return value;
}

function buildClaudeArgs(options = {}) {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--tools',
    READ_ONLY_TOOLS,
    '--allowedTools',
    READ_ONLY_ALLOWED_TOOLS,
    '--disallowedTools',
    'Edit,Write',
  ];
  if (options.resumeSessionId) args.push('--resume', options.resumeSessionId);
  if (options.model) args.push('--model', String(options.model));
  const effort = normalizeEffort(options.effort);
  if (effort) args.push('--effort', effort);
  if (options.maxBudgetUsd)
    args.push('--max-budget-usd', String(options.maxBudgetUsd));
  if (options.jsonSchema)
    args.push('--json-schema', JSON.stringify(options.jsonSchema));
  return args;
}

function validateClaudeArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if (/dangerously|bypassPermissions|acceptEdits/.test(arg)) {
      throw new Error(
        'Refusing to run Claude with write-capable or dangerous options.',
      );
    }

    if (['--tools', '--allowedTools', '--allowed-tools'].includes(arg)) {
      const value = String(args[index + 1] ?? '');
      if (WRITE_TOOLS.test(value)) {
        throw new Error(
          'Refusing to run Claude with write-capable or dangerous options.',
        );
      }
    }
  }
}

export function runClaudePrint(cwd, prompt, options = {}) {
  const args = buildClaudeArgs(options);
  validateClaudeArgs(args);

  const result = runSync('claude', args, {
    cwd,
    input: prompt,
    timeoutMs: options.timeoutMs,
    env: options.env,
  });

  if (result.error?.code === 'ETIMEDOUT') {
    return {
      ok: false,
      status: 124,
      error: `Claude timed out after ${options.timeoutMs}ms.`,
      stdout: result.stdout,
      stderr: result.stderr,
      raw: null,
    };
  }

  let raw = null;
  let parseError = null;
  if (result.stdout.trim()) {
    try {
      raw = JSON.parse(result.stdout);
    } catch (error) {
      parseError = error.message;
    }
  }

  return {
    ok: result.ok && raw != null,
    status: result.status,
    error: result.error?.message ?? parseError,
    stdout: result.stdout,
    stderr: result.stderr,
    raw,
    resultText:
      typeof raw?.result === 'string'
        ? raw.result
        : raw?.result == null
          ? ''
          : JSON.stringify(raw.result),
    sessionId: raw?.session_id ?? null,
    totalCostUsd: raw?.total_cost_usd ?? null,
    usage: raw?.usage ?? null,
    modelUsage: raw?.modelUsage ?? null,
    terminalReason: raw?.terminal_reason ?? null,
  };
}

export function readJsonSchema(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function extractJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return JSON.parse(candidate.slice(first, last + 1));
  }
  return JSON.parse(candidate);
}

export function normalizeReviewPayload(value) {
  let parsed;
  try {
    parsed = extractJsonObject(value);
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput: String(value ?? ''),
    };
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.verdict !== 'string' ||
    typeof parsed.summary !== 'string' ||
    !Array.isArray(parsed.findings) ||
    !Array.isArray(parsed.next_steps)
  ) {
    return {
      parsed: null,
      parseError: 'Claude returned JSON with an unexpected review shape.',
      rawOutput: String(value ?? ''),
    };
  }

  return {
    parsed: {
      verdict: parsed.verdict,
      summary: parsed.summary,
      findings: parsed.findings.map((finding, index) => ({
        severity:
          typeof finding?.severity === 'string' ? finding.severity : 'low',
        title:
          typeof finding?.title === 'string'
            ? finding.title
            : `Finding ${index + 1}`,
        body:
          typeof finding?.body === 'string'
            ? finding.body
            : 'No details provided.',
        file: typeof finding?.file === 'string' ? finding.file : 'unknown',
        line_start: Number.isInteger(finding?.line_start)
          ? finding.line_start
          : null,
        line_end: Number.isInteger(finding?.line_end) ? finding.line_end : null,
        recommendation:
          typeof finding?.recommendation === 'string'
            ? finding.recommendation
            : '',
      })),
      next_steps: parsed.next_steps.filter((step) => typeof step === 'string'),
    },
    parseError: null,
    rawOutput: String(value ?? ''),
  };
}
