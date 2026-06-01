import { readLogPreview } from './state.mjs';

function lineRange(finding) {
  if (!finding.line_start) return '';
  if (!finding.line_end || finding.line_end === finding.line_start)
    return `:${finding.line_start}`;
  return `:${finding.line_start}-${finding.line_end}`;
}

function formatFinding(finding) {
  return [
    `- [${finding.severity}] ${finding.file}${lineRange(finding)} - ${finding.title}`,
    `  ${finding.body}`,
    finding.recommendation
      ? `  Recommendation: ${finding.recommendation}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatCompanionHealth(result) {
  const companion = result.companion;
  if (!companion && !result.parseError && !result.warnings?.length) return [];

  const parts = [];
  if (companion?.resultKind) parts.push(companion.resultKind);
  if (companion?.rawOutput) parts.push(`raw output ${companion.rawOutput}`);
  if (companion?.model) parts.push(`model ${companion.model}`);
  if (companion?.sensitiveContext === 'warned')
    parts.push('sensitive context warning');
  if (companion?.outputRedactions?.length) parts.push('output redacted');
  if (result.parseError) parts.push(`parse fallback: ${result.parseError}`);
  if (!parts.length) return [];
  return ['', `Companion: ${parts.join('; ')}.`];
}

export function renderSetup(report) {
  const lines = [
    '# Claude Code Companion Setup',
    '',
    `Status: ${report.ready ? 'ready' : 'needs attention'}`,
    '',
    'Checks:',
    `- node: ${report.node.detail}`,
    `- claude: ${report.claude.detail}`,
    `- auth: ${report.auth.detail}`,
    `- state: ${report.stateDir}`,
    `- workspace: ${report.workspaceRoot}`,
    `- default model: ${report.defaults.model}`,
    `- default effort: ${report.defaults.effort}`,
    `- default timeout: ${Math.round((report.policy?.timeoutMs ?? 0) / 60000)} minutes`,
    `- sensitive context: ${report.policy?.sensitiveContext ?? 'warn'}`,
    `- subagents: ${report.defaults.subagents.join(', ')}`,
  ];
  if (report.nextSteps.length) {
    lines.push(
      '',
      'Next steps:',
      ...report.nextSteps.map((step) => `- ${step}`),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderReviewResult(result) {
  const review = result.review;
  const lines = [
    `# Claude ${result.reviewName}`,
    '',
    `Target: ${result.targetLabel}`,
    `Verdict: ${review.verdict}`,
    '',
    review.summary,
  ];

  if (review.findings.length) {
    lines.push('', 'Findings:', ...review.findings.map(formatFinding));
  } else {
    lines.push('', 'Findings: none.');
  }

  if (review.next_steps.length) {
    lines.push(
      '',
      'Next steps:',
      ...review.next_steps.map((step) => `- ${step}`),
    );
  }
  lines.push(...formatCompanionHealth(result));
  if (result.sessionId) {
    lines.push('', `Resume in Claude Code: claude -r ${result.sessionId}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderTaskResult(result) {
  const lines = ['# Claude Code Task', '', result.rawOutput || '(no output)'];
  lines.push(...formatCompanionHealth(result));
  if (result.sessionId)
    lines.push('', `Resume in Claude Code: claude -r ${result.sessionId}`);
  return `${lines.join('\n')}\n`;
}

export function renderQueued(payload) {
  return `${payload.title} started as ${payload.jobId}. Check status with the claude_code tool using action "status".\n`;
}

export function renderStatus(report) {
  if (!report.jobs.length) return 'No Claude Code Companion jobs found.\n';
  const lines = ['Claude Code Companion jobs:', ''];
  for (const job of report.jobs) {
    const session = job.sessionId ? ` session=${job.sessionId}` : '';
    lines.push(
      `- ${job.id} ${job.status} ${job.kind}${session} - ${job.summary ?? ''}`.trim(),
    );
    if (job.phase) lines.push(`  phase: ${job.phase}`);
    const preview = readLogPreview(job.logFile, 3);
    if (preview.length) lines.push(...preview.map((line) => `  ${line}`));
  }
  return `${lines.join('\n')}\n`;
}

export function renderStoredResult(payload) {
  if (!payload.job) return 'No matching Claude Code Companion job found.\n';
  if (!payload.result)
    return `Job ${payload.job.id} has no stored result yet.\n`;
  if (payload.job.jobClass === 'review')
    return renderReviewResult(payload.result);
  return renderTaskResult(payload.result);
}
