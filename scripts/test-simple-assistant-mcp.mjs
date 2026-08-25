#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vaultRoot = path.resolve(root, '..', 'personal-vault');
const host = '127.0.0.1';
const reserve = async () => { const server = createServer(); server.listen(0, host); await once(server, 'listening'); const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port; };
const wait = async (url) => { for (let n = 0; n < 100; n += 1) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error(`Timed out: ${url}`); };
const fixture = await mkdtemp(path.join(tmpdir(), 'simple-assistant-'));
const vaultPort = await reserve(); const assistantPort = await reserve();
const vault = spawn(process.execPath, ['mcp/personal-vault-server.mjs'], { cwd: vaultRoot, env: { ...process.env, PERSONAL_VAULT_ROOT: fixture, MCP_HOST: host, MCP_PORT: String(vaultPort) }, stdio: 'ignore' });
let assistant;
try {
  await wait(`http://${host}:${vaultPort}/status`);
  assistant = spawn(process.execPath, ['mcp/personal-assistant-server.mjs'], { cwd: root, env: { ...process.env, MCP_HOST: host, MCP_PORT: String(assistantPort), MCP_GOOGLE_AUTH: 'false', PERSONAL_VAULT_MCP_URL: `http://${host}:${vaultPort}/mcp` }, stdio: 'ignore' });
  await wait(`http://${host}:${assistantPort}/healthz`);
  const client = new Client({ name: 'simple-assistant-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://${host}:${assistantPort}/mcp`)));
  const note = await client.callTool({ name: 'capture_note', arguments: { input: 'Simple readable capture.', title: 'Simple test' } });
  assert.match(note.structuredContent.capturePath, /^raw\/\d{4}\/\d{2}\/.+\.md$/);
  const search = await client.callTool({ name: 'search_vault', arguments: { query: 'readable' } });
  assert.equal(search.structuredContent.matches.length, 1);
  await client.close();
  console.log('Assistant MCP smoke test passed: capture and search use readable Vault files.');
} finally { assistant?.kill('SIGTERM'); vault.kill('SIGTERM'); await rm(fixture, { recursive: true, force: true }); }
