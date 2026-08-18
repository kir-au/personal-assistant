#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreServer = process.env.PERSONAL_VAULT_CORE_MCP
  || path.resolve(dashboardRoot, '..', 'personal-vault-core', 'mcp', 'personal-vault-server.mjs');

const child = spawn(process.execPath, [coreServer], {
  env: process.env,
  stdio: 'inherit',
});

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
