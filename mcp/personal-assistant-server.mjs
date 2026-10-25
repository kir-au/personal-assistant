#!/usr/bin/env node

import { createServer } from 'node:http';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PersonalVaultClient } from '../lib/personal-vault-client.mjs';

const HOST = process.env.MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 8787);
const MCP_PATH = '/mcp';
const PUBLIC_URL = (process.env.MCP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GOOGLE_AUTH_ENABLED = process.env.MCP_GOOGLE_AUTH === 'true';
const SERVICE_TOKENS = new Set((process.env.MCP_SERVICE_TOKENS || '').split(',').map((value) => value.trim()).filter(Boolean));
const AUTH_ENABLED = GOOGLE_AUTH_ENABLED || SERVICE_TOKENS.size > 0;
const ALLOWED_EMAILS = new Set((process.env.GOOGLE_ALLOWED_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
const ALLOWED_DOMAINS = new Set((process.env.GOOGLE_ALLOWED_DOMAINS || '').split(',').map((value) => value.trim().toLowerCase().replace(/^@/, '')).filter(Boolean));
const CHALLENGE_MODE = (process.env.MCP_AUTH_CHALLENGE_MODE || 'http-401').trim().toLowerCase() === 'in-band' ? 'in-band' : 'http-401';
const GOOGLE_USERINFO_URL = process.env.GOOGLE_USERINFO_URL || 'https://www.googleapis.com/oauth2/v3/userinfo';
const OAUTH_SCOPES = ['openid', 'email', 'profile'];
const attachmentSchema = z.object({ name: z.string().optional(), dataBase64: z.string().optional(), dataUrl: z.string().optional(), alt: z.string().optional(), caption: z.string().optional() });

function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function slug(value) { return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'capture'; }
function publicUrl(req) { return PUBLIC_URL || `http://${req?.headers?.host || `localhost:${PORT}`}`; }
function challengeValue(host) {
  const base = PUBLIC_URL || `https://${host || `localhost:${PORT}`}`;
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPES.join(' ')}"`;
}
function authMessage() {
  return SERVICE_TOKENS.size ? 'Provide a valid service token or sign in with the allowed Google account before accessing private Vault files.' : 'Sign in with the allowed Google account before accessing private Vault files.';
}
function authError(req) {
  const challenge = GOOGLE_AUTH_ENABLED ? { 'mcp/www_authenticate': challengeValue(req?.requestInfo?.headers?.host) } : {};
  return { isError: true, content: [{ type: 'text', text: authMessage() }], _meta: challenge };
}
function bearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  return match ? match[1].trim() : null;
}
function matchesServiceToken(token) {
  if (!SERVICE_TOKENS.size) return false;
  const candidate = Buffer.from(String(token));
  let matched = false;
  for (const known of SERVICE_TOKENS) {
    const expected = Buffer.from(known);
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) matched = true;
  }
  return matched;
}
function emailAllowed(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return false;
  if (!ALLOWED_EMAILS.size && !ALLOWED_DOMAINS.size) return true;
  if (ALLOWED_EMAILS.has(value)) return true;
  return ALLOWED_DOMAINS.has(value.slice(value.lastIndexOf('@') + 1));
}
async function tokenAllowed(token) {
  if (!token) return false;
  if (matchesServiceToken(token)) return true;
  if (!GOOGLE_AUTH_ENABLED) return false;
  const response = await fetch(GOOGLE_USERINFO_URL, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  if (!response?.ok) return false;
  const claims = await response.json().catch(() => ({}));
  return emailAllowed(claims.email);
}
async function allowed(extra) {
  if (!AUTH_ENABLED) return true;
  return tokenAllowed(bearerToken(extra?.requestInfo?.headers?.authorization));
}
function sendAuthChallenge(res, host) {
  const headers = { 'content-type': 'application/json' };
  headers['www-authenticate'] = GOOGLE_AUTH_ENABLED ? challengeValue(host) : 'Bearer';
  res.writeHead(401, headers);
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: authMessage() } }));
}
async function usingVault(action) { const vault = new PersonalVaultClient(); try { return await action(vault); } finally { await vault.close().catch(() => {}); } }
function dataForAttachment(attachment) {
  if (attachment.dataBase64) return attachment.dataBase64.replace(/\s+/g, '');
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(attachment.dataUrl || ''));
  if (!match) throw new Error('Each attachment needs dataBase64 or a base64 data URL.');
  return match[1].replace(/\s+/g, '');
}
async function capturePath(vault, title) {
  const [year, month] = today().split('-');
  const base = `${today()}-${slug(title)}`;
  const folder = `raw/${year}/${month}`;
  // A missing folder is already represented by the Vault as an empty list.
  // Transport and authorization failures must remain visible: treating them as
  // an empty folder could select a name that already exists and overwrite it.
  const files = await vault.list(folder, false, 1000);
  let suffix = 1;
  let candidate = `${folder}/${base}.md`;
  const used = new Set((files.items || []).map((item) => item.path));
  while (used.has(candidate)) candidate = `${folder}/${base}-${++suffix}.md`;
  return candidate;
}

function assistantServer() {
  const server = new McpServer({ name: 'personal-assistant', version: '0.4.0' }, { instructions: 'Personal Assistant helps interpret a simple Personal Vault folder. Files remain readable Markdown and normal attachments.' });
  server.registerTool('capture_note', { title: 'capture_note', description: 'Save a readable Markdown note in the Vault.', inputSchema: { input: z.string().min(1), title: z.string().optional(), projectId: z.string().optional(), intent: z.string().optional(), attachments: z.array(attachmentSchema).optional() } }, async ({ input, title, projectId, intent = 'note', attachments = [] }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try {
      return await usingVault(async (vault) => {
        const titleText = title || `Capture - ${today()}`;
        const filePath = await capturePath(vault, titleText);
        let markdown = ['---', `title: ${JSON.stringify(titleText)}`, `created: ${JSON.stringify(new Date().toISOString())}`, `intent: ${JSON.stringify(intent)}`, projectId ? `project: ${JSON.stringify(projectId)}` : '', '---', '', `# ${titleText}`, '', input, ''].filter(Boolean).join('\n');
        await vault.create(filePath, markdown);
        const assets = [];
        for (const attachment of attachments) {
          const asset = await vault.attach(filePath, attachment.name || 'attachment', dataForAttachment(attachment));
          const relative = `./${path.basename(filePath, '.md')}.assets/${path.basename(asset.assetPath)}`;
          markdown += `\n![${String(attachment.alt || attachment.name || 'attachment').replace(/[\[\]\r\n]/g, ' ')}](${relative})\n${attachment.caption ? `\n_${attachment.caption}_\n` : ''}`;
          assets.push(asset);
        }
        if (assets.length) await vault.update(filePath, markdown);
        const proposalSet = { capturePath: filePath, proposals: [{ id: 'review-capture', label: 'Review this capture before changing plans', preview: 'The note is saved. Decide together whether it should affect a plan.' }], questions: [] };
        return { content: [{ type: 'text', text: `Saved readable Markdown: ${filePath}` }], structuredContent: { capturePath: filePath, path: filePath, title: titleText, assetCount: assets.length, assets, proposalSet } };
      });
    } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool('capture_asset', { title: 'capture_asset', description: 'Save files beside an existing Markdown capture.', inputSchema: { capturePath: z.string().min(1), attachments: z.array(attachmentSchema).min(1) } }, async ({ capturePath, attachments }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return await usingVault(async (vault) => {
      let markdown = (await vault.read(capturePath)).content;
      const assets = [];
      for (const attachment of attachments) {
        const asset = await vault.attach(capturePath, attachment.name || 'attachment', dataForAttachment(attachment));
        markdown += `\n![${String(attachment.alt || attachment.name || 'attachment').replace(/[\[\]\r\n]/g, ' ')}](./${path.basename(capturePath, '.md')}.assets/${path.basename(asset.assetPath)})\n`;
        assets.push(asset);
      }
      await vault.update(capturePath, markdown);
      return { content: [{ type: 'text', text: `Saved ${assets.length} attachment(s) beside ${capturePath}.` }], structuredContent: { capturePath, assetCount: assets.length, assets } };
    }); } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool('search_vault', { title: 'search_vault', description: 'Search readable Vault files.', inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(20).optional() } }, async ({ query, limit = 5 }, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return await usingVault(async (vault) => { const result = await vault.search(query, limit); return { content: [{ type: 'text', text: result.matches.length ? `Found ${result.matches.length} match(es).` : 'No matches found.' }], structuredContent: result }; }); } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  server.registerTool('get_today_plan', { title: 'get_today_plan', description: 'Read the current Today plan file.', inputSchema: {} }, async (_args, extra) => {
    if (!(await allowed(extra))) return authError(extra);
    try { return await usingVault(async (vault) => { const file = await vault.read('structured/plans/daily-projection.json'); const plan = JSON.parse(file.content); const tasks = (plan.tasks || []).filter((task) => task.date === today() && task.status !== 'dropped'); return { content: [{ type: 'text', text: tasks.length ? `Today:\n${tasks.map((task) => `- ${task.title}`).join('\n')}` : 'No dated commitments are currently projected.' }], structuredContent: { date: today(), tasks, sourcePath: file.path } }; }); } catch (error) { return { isError: true, content: [{ type: 'text', text: `Could not read Today plan: ${error.message}` }] }; }
  });
  server.registerTool('get_capture_review', { title: 'get_capture_review', description: 'Return the saved capture path for a conversational review.', inputSchema: { capturePath: z.string().min(1) } }, async ({ capturePath }, extra) => (await allowed(extra)) ? ({ content: [{ type: 'text', text: `Review ${capturePath} with the user before changing any plan.` }], structuredContent: { capturePath, status: 'review-in-conversation' } }) : authError(extra));
  server.registerTool('apply_capture_action', { title: 'apply_capture_action', description: 'Record that a user approved a proposal; the Assistant should then make a clear, separate change.', inputSchema: { capturePath: z.string().min(1), proposalId: z.string() } }, async ({ capturePath, proposalId }, extra) => (await allowed(extra)) ? ({ content: [{ type: 'text', text: `The user approved ${proposalId} for ${capturePath}. Make the next Assistant change explicitly and explain it.` }], structuredContent: { capturePath, proposalId, approved: true } }) : authError(extra));
  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) return void res.writeHead(400).end('Missing URL');
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === 'GET' && url.pathname === '/healthz') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', server: 'personal-assistant', version: '0.4.0', mcpEndpoint: `${publicUrl(req)}${MCP_PATH}`, storage: 'readable-files', authentication: [GOOGLE_AUTH_ENABLED ? 'google-oauth' : '', SERVICE_TOKENS.size ? `service-token(${SERVICE_TOKENS.size})` : ''].filter(Boolean).join('+') || 'disabled', googleAllowlist: [ALLOWED_EMAILS.size ? `email(${ALLOWED_EMAILS.size})` : '', ALLOWED_DOMAINS.size ? `domain(${ALLOWED_DOMAINS.size})` : ''].filter(Boolean).join('+') || 'any-verified-google-account', challengeMode: AUTH_ENABLED ? CHALLENGE_MODE : 'none' }));
  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ resource: publicUrl(req), authorization_servers: ['https://accounts.google.com'], scopes_supported: OAUTH_SCOPES }));
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) return void res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, mcp-session-id, authorization', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' }).end();
  if (url.pathname !== MCP_PATH || !['POST', 'GET', 'DELETE'].includes(req.method || '')) return void res.writeHead(404).end('Not Found');
  if (AUTH_ENABLED && CHALLENGE_MODE === 'http-401') {
    const authorized = await tokenAllowed(bearerToken(req.headers.authorization)).catch(() => false);
    if (!authorized) return void sendAuthChallenge(res, req.headers.host);
  }
  const server = assistantServer(); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res); } catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500).end('Internal server error'); }
});

httpServer.listen(PORT, HOST, () => console.log(`Personal Assistant MCP listening on http://${HOST}:${PORT}${MCP_PATH}`));
