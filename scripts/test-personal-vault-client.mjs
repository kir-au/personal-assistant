#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersonalVaultClient, PersonalVaultClientError } from '../lib/personal-vault-client.mjs';

const ASSISTANT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_REPO = path.resolve(ASSISTANT_ROOT, '..', 'personal-vault');
const VAULT_SERVER = path.join(VAULT_REPO, 'mcp', 'personal-vault-server.mjs');
const HOST = '127.0.0.1';

async function reservePort() {
  const server = createServer();
  server.listen(0, HOST);
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForStatus(url, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vault fixture exited with ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function mutationId(letter) {
  return `pvm_${letter.repeat(26)}`;
}

function actor() {
  return { kind: 'application', id: 'personal-assistant', displayName: 'Personal Assistant' };
}

function mutation(operation, letter) {
  const now = new Date().toISOString();
  const requestedBy = actor();
  return {
    contractVersion: 'personal-vault/v1',
    mutationId: mutationId(letter),
    requestedAt: now,
    requestedBy,
    idempotencyKey: `assistant-client-test-${letter}`.padEnd(20, '-'),
    approval: { kind: 'user', approvedAt: now, approvedBy: requestedBy, evidenceRef: `fixture:${letter}` },
    operation,
    provenance: { origin: 'direct', capturedAt: now, capturedBy: requestedBy },
  };
}

async function main() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalUrl = process.env.PERSONAL_VAULT_MCP_URL;
  process.env.NODE_ENV = 'production';
  delete process.env.PERSONAL_VAULT_MCP_URL;
  assert.throws(() => new PersonalVaultClient(), (error) => error instanceof PersonalVaultClientError && error.code === 'configuration_error');
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalUrl === undefined) delete process.env.PERSONAL_VAULT_MCP_URL;
  else process.env.PERSONAL_VAULT_MCP_URL = originalUrl;

  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'assistant-vault-client-'));
  const port = await reservePort();
  const url = `http://${HOST}:${port}/mcp`;
  const child = spawn(process.execPath, [VAULT_SERVER], {
    cwd: VAULT_REPO,
    env: { ...process.env, PERSONAL_VAULT_ROOT: fixtureRoot, MCP_HOST: HOST, MCP_PORT: String(port), MCP_GOOGLE_AUTH: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const diagnostics = [];
  child.stdout.on('data', (chunk) => diagnostics.push(String(chunk)));
  child.stderr.on('data', (chunk) => diagnostics.push(String(chunk)));
  const client = new PersonalVaultClient({ url, timeoutMs: 3000 });

  try {
    await waitForStatus(`http://${HOST}:${port}/status`, child);
    await client.connect();

    const content = 'Client integration fixture.';
    const contentHash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    const created = await client.create(mutation({
      type: 'record.create',
      record: {
        privacy: 'private',
        title: 'Client fixture',
        content: { format: 'markdown', text: content, hash: contentHash },
        provenance: { origin: 'direct', capturedAt: new Date().toISOString(), capturedBy: actor() },
        assetRefs: [],
        metadata: { 'assistant.capture-source': 'chatgpt-mobile' },
      },
    }, 'A'));
    assert.equal(created.record.title, 'Client fixture');
    assert.equal((await client.get(created.record.recordId)).content.text, content);

    const listed = await client.list({ metadata: { 'assistant.capture-source': 'chatgpt-mobile' }, limit: 10 });
    assert.equal(listed.records.length, 1);
    const searched = await client.search('integration fixture', 10);
    assert.equal(searched.matches[0].recordId, created.record.recordId);

    const bytes = Buffer.from('assistant client attachment');
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const attached = await client.attachAsset(mutation({
      type: 'asset.attach',
      recordId: created.record.recordId,
      baseRevision: 1,
      asset: { privacy: 'private', mediaType: 'application/octet-stream', byteLength: bytes.length, contentHash: hash, originalName: 'fixture.bin', provenance: { origin: 'direct', capturedAt: new Date().toISOString(), capturedBy: actor() }, metadata: { 'assistant.fixture': true } },
      reference: { role: 'attachment', caption: 'fixture' },
      payload: { encoding: 'base64', dataBase64: bytes.toString('base64') },
    }, 'B'));
    assert.equal(attached.record.revision, 2);
    assert.ok(attached.asset.assetId.startsWith('pva_'));
    assert.equal((await client.getAsset(attached.asset.assetId)).payload.dataBase64, bytes.toString('base64'));

    const archived = await client.appendMutation(mutation({ type: 'record.archive', recordId: created.record.recordId, baseRevision: 2, reason: 'fixture' }, 'C'));
    assert.equal(archived.record.state, 'archived');
    const changes = await client.listChanges(undefined, 20);
    assert.equal(changes.events.length, 3);

    const unreachablePort = await reservePort();
    const unreachable = new PersonalVaultClient({ url: `http://${HOST}:${unreachablePort}/mcp`, timeoutMs: 200 });
    await assert.rejects(unreachable.connect(), (error) => error instanceof PersonalVaultClientError && error.code === 'connection_failed');
    await unreachable.close();

    console.log('Personal Assistant Vault client integration passed: create/get/list/search/attach/asset-get/append/changes and bounded connection failure.');
  } finally {
    await client.close().catch(() => {});
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await rm(fixtureRoot, { recursive: true, force: true });
    if (child.exitCode && child.signalCode !== 'SIGTERM') throw new Error(`Vault fixture failed:\n${diagnostics.join('')}`);
  }
}

await main();
