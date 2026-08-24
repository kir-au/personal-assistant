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
import { PersonalVaultClient } from '../lib/personal-vault-client.mjs';
import { saveTodayProjection } from '../lib/assistant-vault-workflows.mjs';

const ASSISTANT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_ROOT = path.resolve(ASSISTANT_ROOT, '..', 'personal-vault');
const VAULT_SERVER = path.join(VAULT_ROOT, 'mcp', 'personal-vault-server.mjs');
const ASSISTANT_SERVER = path.join(ASSISTANT_ROOT, 'mcp', 'personal-assistant-server.mjs');
const HOST = '127.0.0.1';

async function reservePort() {
  const server = createServer();
  server.listen(0, HOST);
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Process exited with ${child.exitCode}.`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function spawnProcess(script, cwd, env) {
  const child = spawn(process.execPath, [script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  return { child, output };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'assistant-mcp-fixture-'));
  const vaultPort = await reservePort();
  const assistantPort = await reservePort();
  const vaultUrl = `http://${HOST}:${vaultPort}/mcp`;
  const vaultProcess = spawnProcess(VAULT_SERVER, VAULT_ROOT, { ...process.env, PERSONAL_VAULT_ROOT: fixture, MCP_HOST: HOST, MCP_PORT: String(vaultPort), MCP_GOOGLE_AUTH: 'false' });
  let assistantProcess;
  let assistantClient;
  try {
    await waitFor(`http://${HOST}:${vaultPort}/status`, vaultProcess.child);
    assistantProcess = spawnProcess(ASSISTANT_SERVER, ASSISTANT_ROOT, { ...process.env, MCP_HOST: HOST, MCP_PORT: String(assistantPort), MCP_GOOGLE_AUTH: 'false', ASSISTANT_VAULT_API_ENABLED: 'true', PERSONAL_VAULT_MCP_URL: vaultUrl });
    await waitFor(`http://${HOST}:${assistantPort}/healthz`, assistantProcess.child);
    assistantClient = new Client({ name: 'assistant-mcp-fixture-test', version: '1.0.0' });
    await assistantClient.connect(new StreamableHTTPClientTransport(new URL(`http://${HOST}:${assistantPort}/mcp`)));
    const tools = await assistantClient.listTools();
    for (const name of ['capture_note', 'capture_asset', 'apply_capture_action', 'get_today_plan', 'get_capture_review', 'search_vault']) assert.ok(tools.tools.some((tool) => tool.name === name), `${name} must be public`);

    const note = await assistantClient.callTool({ name: 'capture_note', arguments: { input: 'Fixture note for the new Vault API boundary.', title: 'Assistant fixture', projectId: 'ai', intent: 'note' } });
    assert.notEqual(note.isError, true);
    const capture = note.structuredContent;
    assert.match(capture.recordId, /^pvr_/);
    assert.equal(capture.capturePath, capture.recordId);
    assert.equal(capture.storage, 'personal-vault-api');
    assert.equal(capture.proposalSet.captureRecordId, capture.recordId);

    const review = await assistantClient.callTool({ name: 'get_capture_review', arguments: { capturePath: capture.recordId } });
    assert.notEqual(review.isError, true);
    assert.equal(review.structuredContent.proposalRecordId, capture.proposalSet.proposalRecordId);

    const search = await assistantClient.callTool({ name: 'search_vault', arguments: { query: 'new Vault API boundary' } });
    assert.notEqual(search.isError, true);
    assert.equal(search.structuredContent.matches[0].recordId, capture.recordId);

    const bytes = Buffer.from('generic binary attachment');
    const firstAsset = await assistantClient.callTool({ name: 'capture_asset', arguments: { capturePath: capture.recordId, attachments: [{ name: 'fixture.bin', mimeType: 'application/octet-stream', dataBase64: bytes.toString('base64') }] } });
    assert.notEqual(firstAsset.isError, true);
    assert.match(firstAsset.structuredContent.assets[0].assetId, /^pva_/);
    const secondAsset = await assistantClient.callTool({ name: 'capture_asset', arguments: { capturePath: capture.recordId, attachments: [{ name: 'fixture.bin', mimeType: 'application/octet-stream', dataBase64: bytes.toString('base64') }] } });
    assert.equal(secondAsset.structuredContent.assets[0].assetId, firstAsset.structuredContent.assets[0].assetId, 'asset requests must replay idempotently');

    const vaultClient = new PersonalVaultClient({ url: vaultUrl });
    const beforeInvalid = await vaultClient.get(capture.recordId);
    const invalidAsset = await assistantClient.callTool({ name: 'capture_asset', arguments: { capturePath: capture.recordId, attachments: [{ name: 'bad.bin', mimeType: 'application/octet-stream', dataBase64: 'not-base64!' }] } });
    assert.equal(invalidAsset.isError, true);
    const afterInvalid = await vaultClient.get(capture.recordId);
    assert.equal(afterInvalid.revision, beforeInvalid.revision, 'invalid attachment must not change the record');

    const approved = await assistantClient.callTool({ name: 'apply_capture_action', arguments: { capturePath: capture.recordId, proposalId: 'review-capture' } });
    assert.notEqual(approved.isError, true);
    assert.match(approved.structuredContent.actionRecordId, /^pvr_/);

    await saveTodayProjection({ date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), generatedAt: new Date().toISOString(), tasks: [{ title: 'Fixture today commitment', projectId: 'ai', priority: 1, status: 'active' }] }, { client: vaultClient });
    await vaultClient.close();
    const today = await assistantClient.callTool({ name: 'get_today_plan', arguments: {} });
    assert.notEqual(today.isError, true);
    assert.equal(today.structuredContent.tasks[0].title, 'Fixture today commitment');
    console.log('Assistant MCP fixture acceptance passed: capture, review, generic asset, invalid asset rollback, approval, search and Today projection use only Personal Vault MCP.');
  } finally {
    await assistantClient?.close().catch(() => {});
    await stop(assistantProcess?.child || { exitCode: 0 });
    await stop(vaultProcess.child);
    await rm(fixture, { recursive: true, force: true });
  }
}

await main();
