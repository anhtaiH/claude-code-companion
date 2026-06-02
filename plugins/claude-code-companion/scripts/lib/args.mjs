export function parseArgs(argv = process.argv.slice(2), config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }

    const isLong = token.startsWith('--');
    const raw = isLong ? token.slice(2) : token.slice(1);
    const equals = raw.indexOf('=');
    const rawKey = equals === -1 ? raw : raw.slice(0, equals);
    const key = aliasMap[rawKey] ?? rawKey;

    if (equals !== -1) {
      const value = raw.slice(equals + 1);
      options[key] = booleanOptions.has(key) ? value !== 'false' : value;
      continue;
    }

    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }

    if (!valueOptions.has(key)) {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) {
        options[key] = true;
        continue;
      }
    }

    const next = argv[index + 1];
    if (next == null) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = next;
    index += 1;
  }

  return { options, positionals };
}
