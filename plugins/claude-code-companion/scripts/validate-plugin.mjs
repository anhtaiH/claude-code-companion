#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repoRoot = path.resolve(pluginRoot, '..', '..');
const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
const mcpPath = path.join(pluginRoot, '.mcp.json');
const marketplacePath = path.join(
  repoRoot,
  '.agents',
  'plugins',
  'marketplace.json',
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPath(relativePath, description, base = pluginRoot) {
  const absolutePath = path.resolve(base, relativePath);
  assert(fs.existsSync(absolutePath), `${description} missing: ${relativePath}`);
}

try {
  const manifest = readJson(manifestPath);
  const mcp = readJson(mcpPath);
  const marketplace = readJson(marketplacePath);

  for (const key of [
    'name',
    'version',
    'description',
    'license',
    'skills',
    'mcpServers',
    'interface',
  ]) {
    assert(manifest[key], `plugin manifest missing ${key}`);
  }

  assert(
    !Object.hasOwn(manifest, 'hooks'),
    'v1 plugin must not declare Codex hooks',
  );
  assertPath(manifest.skills, 'skills directory');
  assertPath(manifest.mcpServers, 'MCP manifest');
  assert(
    marketplace.name === manifest.name,
    'marketplace name should match plugin name',
  );
  const marketplacePlugin = marketplace.plugins?.find(
    (plugin) => plugin.name === manifest.name,
  );
  assert(marketplacePlugin, `marketplace entry ${manifest.name} missing`);
  assert(
    marketplacePlugin.source?.source === 'local' &&
      marketplacePlugin.source?.path === './plugins/claude-code-companion',
    'marketplace entry should point at plugin root',
  );

  const server = mcp.mcpServers?.[manifest.name];
  assert(server, `MCP server ${manifest.name} missing`);
  assert(server.command === 'node', 'MCP server should run through node');
  assert(Array.isArray(server.args), 'MCP server args must be an array');
  for (const arg of server.args) {
    if (arg.endsWith('.mjs')) assertPath(arg, `MCP arg ${arg}`);
  }

  for (const requiredFile of [
    'README.md',
    'PRODUCT.md',
    'LICENSE',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    'install.sh',
    '.agents/plugins/marketplace.json',
  ]) {
    assertPath(requiredFile, 'public repo file', repoRoot);
  }

  process.stdout.write('Plugin package validation passed.\n');
} catch (error) {
  process.stderr.write(
    `Plugin package validation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
