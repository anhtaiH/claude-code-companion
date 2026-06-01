const SENSITIVE_PATTERNS = [
  {
    category: 'openai-api-key',
    pattern: /sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{32,}/g,
  },
  {
    category: 'aws-access-key',
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
  {
    category: 'private-key',
    pattern:
      /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    category: 'password-assignment',
    pattern: /^\s*password\s*=\s*\S+/gim,
  },
  {
    category: 'secret-assignment',
    pattern: /^\s*secret\s*=\s*\S+/gim,
  },
  {
    category: 'token-assignment',
    pattern: /^\s*token\s*=\s*\S+/gim,
  },
];

export class SensitiveContextError extends Error {
  constructor(findings) {
    super('Sensitive-looking context found; refusing to send it to Claude.');
    this.name = 'SensitiveContextError';
    this.exitCode = 2;
    this.findings = summarizeFindings(findings);
  }
}

function summarizeFindings(findings) {
  const bySource = new Map();
  for (const finding of findings) {
    const key = `${finding.sourceKind}:${finding.path ?? ''}:${finding.category}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        sourceKind: finding.sourceKind,
        path: finding.path ?? null,
        category: finding.category,
        count: 0,
      });
    }
    bySource.get(key).count += 1;
  }
  return [...bySource.values()];
}

export function scanSensitiveText(value, source = {}) {
  const text = String(value ?? '');
  const findings = [];
  for (const { category, pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      findings.push({
        category,
        sourceKind: source.sourceKind ?? 'text',
        path: source.path ?? null,
      });
      match = pattern.exec(text);
    }
  }
  return findings;
}

export function scanSensitiveSources(sources = []) {
  return sources.flatMap((source) =>
    scanSensitiveText(source.text, {
      sourceKind: source.sourceKind,
      path: source.path,
    }),
  );
}

export function hasSecretLikeText(value) {
  return scanSensitiveText(value).length > 0;
}

export function redactSecretLikeText(value) {
  let text = String(value ?? '');
  for (const { category, pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, `[REDACTED:${category}]`);
  }
  return text;
}

function scanSensitivePayloadValue(value, source) {
  if (typeof value === 'string') return scanSensitiveText(value, source);
  if (Array.isArray(value)) {
    return value.flatMap((entry) => scanSensitivePayloadValue(entry, source));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((entry) =>
      scanSensitivePayloadValue(entry, source),
    );
  }
  return [];
}

function redactPayloadValue(value) {
  if (typeof value === 'string') return redactSecretLikeText(value);
  if (Array.isArray(value)) return value.map((entry) => redactPayloadValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactPayloadValue(entry)]),
    );
  }
  return value;
}

export function redactSensitivePayload(payload) {
  const findings = scanSensitivePayloadValue(payload, {
    sourceKind: 'claude-output',
  });
  if (!findings.length) return { payload, redactions: [] };

  const redacted = redactPayloadValue(payload);
  const redactions = summarizeFindings(findings);
  return {
    payload: {
      ...redacted,
      companion:
        redacted?.companion && typeof redacted.companion === 'object'
          ? {
              ...redacted.companion,
              outputRedactions: redactions,
            }
          : redacted?.companion,
      redactions,
    },
    redactions,
  };
}

export function blockSensitiveContext(sources, options = {}) {
  const findings = scanSensitiveSources(sources);
  if (!findings.length) return [];
  if (options.strictSensitiveContext) {
    throw new SensitiveContextError(findings);
  }
  return summarizeFindings(findings);
}
