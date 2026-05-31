#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
const mcpPath = path.join(root, '.mcp.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPath(relativePath, description) {
  const absolutePath = path.resolve(root, relativePath);
  assert(fs.existsSync(absolutePath), `${description} missing: ${relativePath}`);
}

try {
  const manifest = readJson(manifestPath);
  const mcp = readJson(mcpPath);

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
  ]) {
    assertPath(requiredFile, 'public repo file');
  }

  process.stdout.write('Plugin package validation passed.\n');
} catch (error) {
  process.stderr.write(
    `Plugin package validation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
