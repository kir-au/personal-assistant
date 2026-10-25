#!/usr/bin/env node
// Proves authorization on the Assistant MCP server:
//   - machine clients authenticate with a service token
//   - Google bearer tokens are checked against an email/domain allowlist
//   - unauthenticated requests get a real HTTP 401 with WWW-Authenticate
//   - the legacy in-band challenge mode still works when asked for
// Uses throwaway ports, a throwaway Vault folder and a stub Google userinfo endpoint.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vaultRepo = process.env.PERSONAL_VAULT_REPO || '/Users/kirill/development/personal/personal-vault';
const host = '127.0.0.1';
const TOKEN = 'a'.repeat(64);
const WRONG = 'b'.repeat(64);
const ALLOWED_EMAIL = 'kirill.frolov@gmail.com';
const ALLOWED_DOMAIN = 'example.com';

const freePort = async () => {
  const probe = createProbe();
  probe.listen(0, host);
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

const waitUp = async (url, label) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const textOf = async (client, name, args) =>
  (await client.callTool({ name, arguments: args })).content?.find((c) => c.type === 'text')?.text ?? '';

const connect = async (url, headers) => {
  const client = new Client({ name: 'auth-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
};

const rawCall = (url, headers, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });

const toolsList = (url, headers) => rawCall(url, headers, { jsonrpc: '2.0', id: 1, method: 'tools/list' });

// Stub of Google's userinfo endpoint: the bearer token IS the email address.
const userinfo = createServer((req, res) => {
  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
  if (!token || !token.includes('@')) {
    res.writeHead(401, { 'content-type': 'application/json' }).end('{}');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ email: token }));
});

const fixture = await mkdtemp(path.join(tmpdir(), 'assistant-auth-test-'));
const userinfoPort = await freePort();
const vaultPort = await freePort();
const assistantPort = await freePort();
await new Promise((resolve) => userinfo.listen(userinfoPort, host, resolve));

const vault = spawn(process.execPath, ['mcp/personal-vault-server.mjs'], {
  cwd: vaultRepo,
  env: { ...process.env, PERSONAL_VAULT_ROOT: fixture, MCP_HOST: host, MCP_PORT: String(vaultPort), MCP_GOOGLE_AUTH: 'false' },
  stdio: 'ignore',
});

const startAssistant = (extraEnv = {}) => spawn(process.execPath, ['mcp/personal-assistant-server.mjs'], {
  cwd: dashboard,
  env: {
    ...process.env,
    MCP_HOST: host,
    MCP_PORT: String(assistantPort),
    MCP_GOOGLE_AUTH: 'true',
    GOOGLE_ALLOWED_EMAILS: ALLOWED_EMAIL,
    GOOGLE_ALLOWED_DOMAINS: ALLOWED_DOMAIN,
    GOOGLE_USERINFO_URL: `http://${host}:${userinfoPort}/userinfo`,
    MCP_SERVICE_TOKENS: TOKEN,
    PERSONAL_VAULT_MCP_URL: `http://${host}:${vaultPort}/mcp`,
    ...extraEnv,
  },
  stdio: 'ignore',
});

let checks = 0;
const check = (label, condition) => {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok  ${label}`);
};

let assistant = startAssistant();

try {
  await waitUp(`http://${host}:${vaultPort}/status`, 'Vault');
  await waitUp(`http://${host}:${assistantPort}/healthz`, 'Assistant');
  const url = `http://${host}:${assistantPort}/mcp`;

  const health = await (await fetch(`http://${host}:${assistantPort}/healthz`)).json();
  console.log(`1) healthz: authentication=${health.authentication} allowlist=${health.googleAllowlist} mode=${health.challengeMode}`);
  check('both schemes advertised', health.authentication === 'google-oauth+service-token(1)');
  check('email and domain allowlists reported', health.googleAllowlist === 'email(1)+domain(1)');
  check('http-401 challenge mode is the default', health.challengeMode === 'http-401');

  console.log('2) unauthenticated request gets a real HTTP 401');
  const anon = await toolsList(url, {});
  const challenge = anon.headers.get('www-authenticate') || '';
  console.log(`    status=${anon.status} www-authenticate=${challenge.slice(0, 72)}…`);
  check('status is 401', anon.status === 401);
  check('WWW-Authenticate advertises protected-resource metadata', challenge.includes('resource_metadata='));
  check('tools/list is not readable without a token', (await anon.json()).result === undefined);

  console.log('3) a wrong service token is refused');
  check('wrong token gives 401', (await toolsList(url, { authorization: `Bearer ${WRONG}` })).status === 401);

  console.log('4) the correct service token is accepted');
  const machine = await connect(url, { authorization: `Bearer ${TOKEN}` });
  const saved = await textOf(machine, 'capture_note', { input: 'Service token note.', title: 'Service Token Note' });
  check('capture_note wrote a readable file', /Saved readable Markdown: raw\//.test(saved));
  check('the note is searchable', /Found 1 match/.test(await textOf(machine, 'search_vault', { query: 'Service Token Note' })));
  await machine.close();

  console.log('5) Google bearer tokens follow the allowlist');
  const byEmail = await connect(url, { authorization: `Bearer ${ALLOWED_EMAIL}` });
  check('allow-listed email is accepted', /Found 1 match/.test(await textOf(byEmail, 'search_vault', { query: 'Service Token Note' })));
  await byEmail.close();

  const byDomain = await connect(url, { authorization: `Bearer someone@${ALLOWED_DOMAIN}` });
  check('allow-listed domain is accepted', /Found 1 match/.test(await textOf(byDomain, 'search_vault', { query: 'Service Token Note' })));
  await byDomain.close();

  check('a Google account outside the allowlist is refused', (await toolsList(url, { authorization: 'Bearer stranger@evil.test' })).status === 401);
  check('a malformed bearer value is refused', (await toolsList(url, { authorization: 'Bearer nonsense' })).status === 401);

  console.log('6) legacy in-band challenge mode still works');
  assistant.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assistant = startAssistant({ MCP_AUTH_CHALLENGE_MODE: 'in-band' });
  await waitUp(`http://${host}:${assistantPort}/healthz`, 'Assistant (in-band)');
  const legacyHealth = await (await fetch(`http://${host}:${assistantPort}/healthz`)).json();
  check('healthz reports in-band mode', legacyHealth.challengeMode === 'in-band');
  // NOTE: the query must satisfy the tool schema, otherwise the SDK rejects the call with an
  // input-validation error before the handler runs and the auth challenge is never produced.
  const legacy = await rawCall(url, {}, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_vault', arguments: { query: 'legacy probe' } } });
  const legacyBody = await legacy.json();
  console.log(`    status=${legacy.status} has mcp/www_authenticate=${'mcp/www_authenticate' in (legacyBody.result?._meta || {})}`);
  check('legacy mode returns HTTP 200', legacy.status === 200);
  check('legacy mode still carries the in-band challenge', 'mcp/www_authenticate' in (legacyBody.result?._meta || {}));

  console.log('7) a service-token-only server sends a plain Bearer challenge');
  assistant.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assistant = startAssistant({ MCP_GOOGLE_AUTH: 'false', GOOGLE_ALLOWED_EMAILS: '', GOOGLE_ALLOWED_DOMAINS: '' });
  await waitUp(`http://${host}:${assistantPort}/healthz`, 'Assistant (token only)');
  const soloHealth = await (await fetch(`http://${host}:${assistantPort}/healthz`)).json();
  check('healthz shows service-token only', soloHealth.authentication === 'service-token(1)');
  const solo = await toolsList(url, {});
  console.log(`    status=${solo.status} www-authenticate=${JSON.stringify(solo.headers.get('www-authenticate'))}`);
  check('plain Bearer challenge, no Google metadata', solo.headers.get('www-authenticate') === 'Bearer');
  const soloGood = await connect(url, { authorization: `Bearer ${TOKEN}` });
  check('service token still works without Google auth', /Found 1 match/.test(await textOf(soloGood, 'search_vault', { query: 'Service Token Note' })));
  await soloGood.close();

  console.log(`\nAssistant auth test passed: ${checks} checks.`);
} finally {
  vault.kill('SIGTERM');
  assistant.kill('SIGTERM');
  userinfo.close();
  await rm(fixture, { recursive: true, force: true });
}
