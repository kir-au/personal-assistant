#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'mcp', 'personal-assistant-server.mjs'), 'utf8');
for (const forbidden of ['node:fs', 'VAULT_ROOT', 'PERSONAL_VAULT_ROOT']) {
  assert.equal(source.includes(forbidden), false, `Assistant MCP must not contain ${forbidden}`);
}
console.log('Assistant MCP boundary check passed: no filesystem import or legacy Vault path remains.');
