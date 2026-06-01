import fs from 'node:fs';
import process from 'node:process';
import { binaryAvailable, runSync } from './process.mjs';
import { hasSecretLikeText } from './safety.mjs';

const READ_ONLY_TOOLS = 'Read,Glob,Grep,Bash,Agent';
const READ_ONLY_ALLOWED_TOOLS =
  'Read,Glob,Grep,Agent,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*)';
const WRITE_TOOLS = /\b(?:Edit|Write)\b/;
const DEFAULT_MODEL = 'opus[1m]';
const DEFAULT_EFFORT = 'max';
const AGENT_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'];
const AGENT_DISALLOWED_TOOLS = ['Edit', 'Write'];
export { hasSecretLikeText };

export function getClaudeAvailability(cwd) {
  return binaryAvailable('claude', ['--version'], { cwd });
}

export function getClaudeDefaults() {
  return {
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    ultracode: true,
    subagents: Object.keys(buildCompanionAgents()),
    tools: READ_ONLY_TOOLS,
    allowedTools: READ_ONLY_ALLOWED_TOOLS,
    disallowedTools: 'Edit,Write',
  };
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

function shouldUseUltracode(options = {}) {
  return !options.effort;
}

function companionAgent(prompt, description, extra = {}) {
  return {
    description,
    prompt: [
      prompt,
      '',
      'You are running under Claude Code Companion for Codex.',
      'Stay read-only. Do not edit files, write files, or run mutating commands.',
      'Use only read-only repository inspection and git read commands.',
      'Return concise findings with file paths and concrete evidence.',
    ].join('\n'),
    tools: AGENT_TOOLS,
    disallowedTools: AGENT_DISALLOWED_TOOLS,
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    background: true,
    ...extra,
  };
}

function buildCompanionAgents() {
  return {
    'codebase-researcher': companionAgent(
      'Map the relevant repository area before review. Find important files, local instructions, ownership boundaries, and existing test patterns.',
      'Use for repo reconnaissance, instruction gathering, and finding relevant files before review or planning.',
    ),
    'test-gap-reviewer': companionAgent(
      'Find missing tests, weak assertions, untested edge cases, and risky behavior not covered by the changed test set.',
      'Use for test coverage and regression-risk analysis.',
    ),
    'security-reviewer': companionAgent(
      'Review for auth, secrets, privacy, injection, unsafe defaults, permission mistakes, and data exposure.',
      'Use for security, privacy, auth, and permission review.',
    ),
    'architecture-critic': companionAgent(
      'Challenge the design direction. Look for unnecessary coupling, unclear boundaries, brittle abstractions, and simpler implementation paths.',
      'Use for architecture, design, refactor, and maintainability critique.',
    ),
    'release-risk-reviewer': companionAgent(
      'Assess rollout, rollback, migration, operational, dependency, and customer-facing regression risks. Recommend focused smoke checks.',
      'Use for release risk, rollback, dependency, and operational review.',
    ),
    'log-diagnostician': companionAgent(
      'Analyze logs, stack traces, and failing command output. Identify likely root cause and the smallest verification step.',
      'Use for failures, logs, CI output, and root-cause diagnosis.',
    ),
  };
}

function buildClaudeSettings() {
  return {
    ultracode: true,
  };
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
  args.push('--model', String(options.model || DEFAULT_MODEL));
  const effort = normalizeEffort(options.effort || DEFAULT_EFFORT);
  if (effort) args.push('--effort', effort);
  if (shouldUseUltracode(options))
    args.push('--settings', JSON.stringify(buildClaudeSettings()));
  if (options.subagents !== false)
    args.push('--agents', JSON.stringify(buildCompanionAgents()));
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

    if (arg === '--agents') {
      const value = String(args[index + 1] ?? '');
      let agents;
      try {
        agents = JSON.parse(value);
      } catch {
        throw new Error('Refusing to run Claude with invalid agent config.');
      }
      const agentValues = Object.values(agents ?? {});
      const writeCapable = agentValues.some((agent) => {
        const tools = [
          ...(Array.isArray(agent?.tools) ? agent.tools : []),
          ...(Array.isArray(agent?.allowedTools) ? agent.allowedTools : []),
        ].join(',');
        return WRITE_TOOLS.test(tools);
      });
      if (
        writeCapable ||
        /bypassPermissions|acceptEdits/.test(JSON.stringify(agents))
      ) {
        throw new Error(
          'Refusing to run Claude with write-capable or dangerous agent config.',
        );
      }
    }
  }
}

function parseClaudeOutput(stdout) {
  const text = stdout.trim();
  if (!text) {
    return { raw: null, parseError: null, eventCount: 0, assistantText: '' };
  }

  try {
    const raw = JSON.parse(text);
    return {
      raw,
      parseError: null,
      eventCount: 1,
      assistantText: assistantTextFromEvents([raw]),
    };
  } catch (error) {
    const events = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        return {
          raw: null,
          parseError: error.message,
          eventCount: events.length,
          assistantText: assistantTextFromEvents(events),
        };
      }
    }
    const result = events.findLast((event) => event?.type === 'result') ?? null;
    return {
      raw: result,
      parseError: result ? null : error.message,
      eventCount: events.length,
      assistantText: assistantTextFromEvents(events),
    };
  }
}

function assistantTextFromEvents(events) {
  return events.flatMap((event) => textFragmentsFromEvent(event)).join('\n\n');
}

function textFragmentsFromEvent(event) {
  const content = event?.message?.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .map((entry) => (entry?.type === 'text' ? entry.text : null))
    .filter((entry) => typeof entry === 'string' && entry.trim());
}

export function runClaudePrint(cwd, prompt, options = {}) {
  const args = buildClaudeArgs(options);
  validateClaudeArgs(args);

  const result = runSync('claude', args, {
    cwd,
    input: prompt,
    timeoutMs: options.timeoutMs,
    env: {
      ...process.env,
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
        process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ?? '80',
      ...(options.env ?? {}),
    },
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

  const parsed = parseClaudeOutput(result.stdout);
  const raw = parsed.raw;
  const parseError = parsed.parseError;
  const status = result.ok && raw != null ? result.status : result.status || 1;
  const rawResultText =
    typeof raw?.result === 'string'
      ? raw.result
      : raw?.result == null
        ? ''
        : JSON.stringify(raw.result);
  const assistantText = parsed.assistantText.trim();
  const resultText =
    assistantText.length > rawResultText.trim().length
      ? assistantText
      : rawResultText;

  return {
    ok: result.ok && raw != null,
    status,
    error: result.error?.message ?? parseError,
    stdout: result.stdout,
    stderr: result.stderr,
    raw,
    eventCount: parsed.eventCount,
    resultText,
    resultTextSource:
      resultText === assistantText && assistantText
        ? 'assistant-events'
        : 'result-event',
    sessionId: raw?.session_id ?? null,
    totalCostUsd: raw?.total_cost_usd ?? null,
    usage: raw?.usage ?? null,
    modelUsage: raw?.modelUsage ?? null,
    effectiveModels:
      raw?.modelUsage && typeof raw.modelUsage === 'object'
        ? Object.keys(raw.modelUsage)
        : [],
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
    const markdownReview = normalizeMarkdownReview(String(value ?? ''));
    if (markdownReview) {
      return {
        parsed: markdownReview,
        parseError: null,
        rawOutput: String(value ?? ''),
      };
    }
    return {
      parsed: null,
      parseError: error.message,
      rawOutput: String(value ?? ''),
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      parsed: null,
      parseError: 'Claude returned JSON with an unexpected review shape.',
      rawOutput: String(value ?? ''),
    };
  }

  if (typeof parsed.verdict !== 'string' || typeof parsed.summary !== 'string') {
    const groupedReview = normalizeGroupedReview(parsed);
    if (groupedReview) {
      return {
        parsed: groupedReview,
        parseError: null,
        rawOutput: String(value ?? ''),
      };
    }
    return {
      parsed: null,
      parseError: 'Claude returned JSON with an unexpected review shape.',
      rawOutput: String(value ?? ''),
    };
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const nextSteps = Array.isArray(parsed.next_steps)
    ? parsed.next_steps
    : Array.isArray(parsed.nextSteps)
      ? parsed.nextSteps
      : [];

  return {
    parsed: {
      verdict: parsed.verdict,
      summary: parsed.summary,
      findings: findings.map((finding, index) =>
        normalizeFinding(finding, index),
      ),
      next_steps: nextSteps.filter((step) => typeof step === 'string'),
    },
    parseError: null,
    rawOutput: String(value ?? ''),
  };
}

function normalizeFinding(finding, index) {
  const location =
    typeof finding?.location === 'string' ? finding.location : '';
  const locationMatch = location.match(/^(.+?)(?::(\d+))?$/);
  const parsedLine = Number.parseInt(locationMatch?.[2] ?? '', 10);
  return {
    severity: typeof finding?.severity === 'string' ? finding.severity : 'low',
    title:
      typeof finding?.title === 'string'
        ? finding.title
        : `Finding ${index + 1}`,
    body:
      typeof finding?.body === 'string'
        ? finding.body
        : typeof finding?.detail === 'string'
          ? finding.detail
          : 'No details provided.',
    file:
      typeof finding?.file === 'string'
        ? finding.file
        : locationMatch?.[1] || 'unknown',
    line_start: Number.isInteger(finding?.line_start)
      ? finding.line_start
      : Number.isInteger(parsedLine)
        ? parsedLine
        : null,
    line_end: Number.isInteger(finding?.line_end) ? finding.line_end : null,
    recommendation:
      typeof finding?.recommendation === 'string'
        ? finding.recommendation
        : '',
  };
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

function normalizeGroupedReview(parsed) {
  const findings = [];
  const presentSeverities = SEVERITIES.filter((severity) =>
    Object.hasOwn(parsed, severity),
  );
  for (const severity of SEVERITIES) {
    const value = parsed[severity];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const finding of value) {
        if (isNoFindingValue(finding)) continue;
        findings.push({ ...coerceFindingObject(finding), severity });
      }
      continue;
    }
    if (!isNoFindingValue(value)) {
      findings.push({
        severity,
        title: titleFromText(value),
        body: String(value),
        ...locationFromText(value),
      });
    }
  }
  if (!presentSeverities.length) return null;
  return {
    verdict: findings.some((finding) =>
      ['critical', 'high'].includes(finding.severity),
    )
      ? 'changes-needed'
      : findings.length
        ? 'needs-attention'
        : 'approve',
    summary: findings.length
      ? `Claude returned ${findings.length} grouped finding(s).`
      : 'Claude returned no grouped findings.',
    findings: findings.map((finding, index) =>
      normalizeFinding(finding, index),
    ),
    next_steps: [],
  };
}

function normalizeMarkdownReview(text) {
  const sections = sectionBySeverity(text);
  const headingFindings = findingHeadingsBySeverity(text);
  if (!sections.size && !headingFindings.length) return null;
  const findings = [];
  for (const severity of SEVERITIES) {
    const body = sections.get(severity);
    if (!body || isNoFindingValue(body)) continue;
    for (const chunk of findingChunks(body)) {
      if (isNoFindingValue(chunk)) continue;
      findings.push({
        severity,
        title: titleFromText(chunk),
        body: chunk.trim(),
        ...locationFromText(chunk),
      });
    }
  }
  findings.push(...headingFindings);
  return {
    verdict: findings.some((finding) =>
      ['critical', 'high'].includes(finding.severity),
    )
      ? 'changes-needed'
      : findings.length
        ? 'needs-attention'
        : 'approve',
    summary: findings.length
      ? `Claude returned ${findings.length} markdown finding(s).`
      : 'Claude returned markdown severity sections with no findings.',
    findings: findings.map((finding, index) =>
      normalizeFinding(finding, index),
    ),
    next_steps: [],
  };
}

function findingHeadingsBySeverity(text) {
  const lines = String(text).split(/\r?\n/);
  const findings = [];
  let current = null;

  function flush() {
    if (!current) return;
    const body = current.body.join('\n').trim();
    if (isNoFindingValue(current.title) && isNoFindingValue(body)) {
      current = null;
      return;
    }
    findings.push({
      severity: current.severity,
      title: current.title,
      body: body || current.title,
      ...locationFromText(`${current.title}\n${body}`),
    });
    current = null;
  }

  for (const line of lines) {
    const heading = parseFindingHeading(line);
    if (heading) {
      flush();
      current = { ...heading, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();

  return findings;
}

function parseFindingHeading(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed || /^[-*]\s+/.test(trimmed)) return null;
  const heading = trimmed
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
  const match =
    heading.match(
      /^(?:Finding\s+\d+\s*[-–—:]\s*)?(Critical|High|Medium|Low)\s*[-–—:]\s*(.+)$/i,
    ) ??
    heading.match(/^\[(Critical|High|Medium|Low)\]\s*(.+)$/i);
  if (!match) return null;
  const title = match[2].trim() || 'Finding';
  if (isNoFindingValue(title)) return null;
  return {
    severity: match[1].toLowerCase(),
    title,
  };
}

function sectionBySeverity(text) {
  const sectionLines = new Map();
  let currentSeverity = null;

  for (const line of String(text).split(/\r?\n/)) {
    const heading = parseReviewHeading(line);
    if (heading) {
      currentSeverity = heading.severity;
      if (currentSeverity && heading.remainder) {
        appendSectionLine(sectionLines, currentSeverity, heading.remainder);
      }
      continue;
    }

    if (currentSeverity) {
      appendSectionLine(sectionLines, currentSeverity, line);
    }
  }

  const sections = new Map();
  for (const [severity, lines] of sectionLines) {
    const body = lines.join('\n').trim();
    if (body) sections.set(severity, body);
  }
  return sections;
}

function appendSectionLine(sections, severity, line) {
  if (!sections.has(severity)) sections.set(severity, []);
  sections.get(severity).push(line);
}

function parseReviewHeading(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed || /^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
    return null;
  }

  const withoutHashes = trimmed.replace(/^#{1,6}\s+/, '');
  const bold = withoutHashes.match(/^\*\*([^*]+)\*\*\s*:?\s*(.*)$/);
  const candidate = bold
    ? `${bold[1].trim()}${bold[2] ? `: ${bold[2].trim()}` : ''}`
    : withoutHashes;
  const severity = candidate.match(
    /^(Critical|High|Medium|Low)(?:\s*\/\s*info)?(?:\s+(?:findings?|issues?))?(?::\s*(.*)|\s*$)/i,
  );
  if (severity) {
    return {
      severity: severity[1].toLowerCase(),
      remainder: severity[2]?.trim() ?? '',
    };
  }

  if (
    /^#{1,6}\s+/.test(trimmed) ||
    (bold && isNonSeverityReviewHeading(bold[1])) ||
    /^\*\*[^*]{1,80}\*\*\s*:?\s*$/.test(trimmed) ||
    isNonSeverityReviewHeading(withoutHashes)
  ) {
    return { severity: null, remainder: '' };
  }

  return null;
}

function isNonSeverityReviewHeading(value) {
  return /^(?:Repo Findings|Findings|Companion Observations|Companion Notes|Claude Review|Run metadata|Operational note)\b/i.test(
    String(value ?? '').trim(),
  );
}

function findingChunks(section) {
  const lines = String(section).split(/\r?\n/);
  const chunks = [];
  const proseLines = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (current) chunks.push(current.join('\n').trim());
      current = [bullet[1].trim()];
      continue;
    }

    if (current) {
      current.push(trimmed);
    } else {
      proseLines.push(trimmed);
    }
  }

  if (current) chunks.push(current.join('\n').trim());
  if (chunks.length) return chunks.filter(Boolean);
  return [proseLines.join('\n').trim()].filter(Boolean);
}

function coerceFindingObject(value) {
  if (value && typeof value === 'object') return value;
  return {
    title: titleFromText(value),
    body: String(value ?? ''),
    ...locationFromText(value),
  };
}

function isNoFindingValue(value) {
  const text = String(value ?? '').trim();
  return !text || /^(?:none|no\b|no findings|n\/a|not applicable)/i.test(text);
}

function titleFromText(value) {
  return String(value ?? '')
    .split(/\r?\n|\. /)[0]
    .replace(/^`?([^`:]+)`?:\s*/, '$1: ')
    .slice(0, 120)
    .trim() || 'Finding';
}

function locationFromText(value) {
  const text = String(value ?? '');
  const markdownLink = text.match(/\]\(([^:)]+):(\d+)\)/);
  if (markdownLink) {
    return {
      file: markdownLink[1],
      line_start: Number.parseInt(markdownLink[2], 10),
    };
  }
  const inline = text.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)/);
  if (inline) {
    return {
      file: inline[1],
      line_start: Number.parseInt(inline[2], 10),
    };
  }
  return {};
}
