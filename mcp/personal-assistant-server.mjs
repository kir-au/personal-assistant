#!/usr/bin/env node

import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { PersonalVaultClient } from '../lib/personal-vault-client.mjs';
import { approveProposal, attachAssets, createCapture, createProposal, getProposal, readTodayProjection } from '../lib/assistant-vault-workflows.mjs';

const HOST = process.env.MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.MCP_PORT || process.env.PORT || 8787);
const MCP_PATH = '/mcp';
const MCP_PUBLIC_BASE_URL = (process.env.MCP_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const GOOGLE_AUTH_ENABLED = process.env.MCP_GOOGLE_AUTH === 'true';
const GOOGLE_ALLOWED_EMAILS = new Set((process.env.GOOGLE_ALLOWED_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
const GOOGLE_ALLOWED_DOMAINS = new Set((process.env.GOOGLE_ALLOWED_DOMAINS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
const GOOGLE_AUTHORIZATION_SERVER = process.env.GOOGLE_AUTHORIZATION_SERVER || 'https://accounts.google.com';
const OAUTH_SCOPES = ['openid', 'email', 'profile'];
const ASSISTANT_VAULT_API_ENABLED = process.env.ASSISTANT_VAULT_API_ENABLED === 'true';
const tokenCache = new Map();
const attachmentSchema = z.object({ name: z.string().optional(), mimeType: z.string().optional(), dataBase64: z.string().optional(), dataUrl: z.string().optional(), alt: z.string().optional(), caption: z.string().optional() });

const routingInstructions = [
  'Personal Assistant interprets Personal Vault records. Personal Vault stores generic records, assets and provenance only.',
  'capture_note stores a readable source record and returns Assistant-owned review proposals. Do not apply a proposal without explicit user approval.',
  'get_today_plan reads an Assistant-owned projection record. search_vault searches generic Vault records.',
].join(' ');

function getHeader(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getPublicBaseUrl(req) {
  if (MCP_PUBLIC_BASE_URL) return MCP_PUBLIC_BASE_URL;
  const host = req?.headers?.host || `localhost:${PORT}`;
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function getPublicBaseUrlFromExtra(extra) {
  if (MCP_PUBLIC_BASE_URL) return MCP_PUBLIC_BASE_URL;
  const headers = extra?.requestInfo?.headers || {};
  const host = getHeader(headers, 'host') || `localhost:${PORT}`;
  const proto = getHeader(headers, 'x-forwarded-proto') || (String(host).includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function authError(extra, reason) {
  const baseUrl = getPublicBaseUrlFromExtra(extra);
  return { isError: true, content: [{ type: 'text', text: 'Personal Assistant requires Google authentication before it can access private records.' }], _meta: { 'mcp/www_authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPES.join(' ')}", error="invalid_token", error_description="${reason}"` } };
}

function apiDisabledError() {
  return { isError: true, content: [{ type: 'text', text: 'Personal Vault API mode is disabled. Enable ASSISTANT_VAULT_API_ENABLED after the companion Vault MCP is running.' }] };
}

function isAllowedGoogleUser(profile) {
  const email = String(profile?.email || '').toLowerCase();
  if (!email) return false;
  if (GOOGLE_ALLOWED_EMAILS.size && GOOGLE_ALLOWED_EMAILS.has(email)) return true;
  const domain = email.split('@')[1];
  if (GOOGLE_ALLOWED_DOMAINS.size && GOOGLE_ALLOWED_DOMAINS.has(domain)) return true;
  return !GOOGLE_ALLOWED_EMAILS.size && !GOOGLE_ALLOWED_DOMAINS.size;
}

async function verifyGoogleAccessToken(token) {
  const cached = tokenCache.get(token);
  if (cached?.expiresAt > Date.now()) return cached.profile;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const profile = await response.json();
  if (!isAllowedGoogleUser(profile)) return null;
  tokenCache.set(token, { profile, expiresAt: Date.now() + 5 * 60 * 1000 });
  return profile;
}

async function requireGoogleAuth(extra) {
  if (!GOOGLE_AUTH_ENABLED) return { ok: true };
  const authorization = getHeader(extra?.requestInfo?.headers || {}, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ''));
  if (!match) return { ok: false, reason: 'No Personal Assistant access token was provided.' };
  return (await verifyGoogleAccessToken(match[1])) ? { ok: true } : { ok: false, reason: 'The Personal Assistant access token is invalid, expired, or not allowed.' };
}

async function withVault(operation) {
  const client = new PersonalVaultClient();
  try {
    await client.connect();
    return await operation(client);
  } finally {
    await client.close().catch(() => {});
  }
}

function groupTasks(tasks) {
  return tasks.reduce((groups, task) => {
    const key = task.projectId || 'inbox';
    (groups[key] ||= []).push(task);
    return groups;
  }, {});
}

export function createPersonalAssistantServer() {
  const server = new McpServer({ name: 'personal-assistant', version: '0.2.0' }, { instructions: routingInstructions });

  server.registerTool('capture_note', {
    title: 'capture_note',
    description: 'Save an approved note as a readable Personal Vault record and return Assistant-owned proposals.',
    inputSchema: { input: z.string().min(1), title: z.string().optional(), projectId: z.string().optional(), intent: z.enum(['note', 'achievement', 'workout', 'task', 'decision', 'question', 'replan']).optional(), attachments: z.array(attachmentSchema).optional() },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }] },
  }, async ({ input, title, projectId, intent, attachments }, extra) => {
    const auth = await requireGoogleAuth(extra);
    if (!auth.ok) return authError(extra, auth.reason);
    if (!ASSISTANT_VAULT_API_ENABLED) return apiDisabledError();
    try {
      const capture = await withVault((client) => createCapture(input, { title, projectId, intent, attachments, client }));
      const proposalSet = await withVault((client) => createProposal(capture.record, { client }));
      const proposalText = proposalSet.proposals.map((proposal, index) => `${index + 1}. ${proposal.id}: ${proposal.label} - ${proposal.preview}`).join('\n');
      return { content: [{ type: 'text', text: `Saved capture ${capture.recordId} in Personal Vault.\n\nAttachments: ${capture.assetCount}.\n\nProposed next actions:\n${proposalText}\n\nConfirmation needed before applying a proposal.` }], structuredContent: { ...capture, proposalSet } };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Could not save capture: ${error.message}` }] };
    }
  });

  server.registerTool('capture_asset', {
    title: 'capture_asset',
    description: 'Attach files to a capture record. Use the recordId/capturePath returned by capture_note.',
    inputSchema: { capturePath: z.string().regex(/^pvr_[0-9A-HJKMNP-TV-Z]{26}$/), attachments: z.array(attachmentSchema).min(1) },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }] },
  }, async ({ capturePath, attachments }, extra) => {
    const auth = await requireGoogleAuth(extra);
    if (!auth.ok) return authError(extra, auth.reason);
    if (!ASSISTANT_VAULT_API_ENABLED) return apiDisabledError();
    try {
      const result = await withVault((client) => attachAssets(capturePath, attachments, { client }));
      return { content: [{ type: 'text', text: `Attached ${result.assets.length} asset(s) to ${capturePath}.` }], structuredContent: { capturePath, recordId: result.record.recordId, assetCount: result.assets.length, assets: result.assets } };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Could not attach assets: ${error.message}` }] };
    }
  });

  server.registerTool('apply_capture_action', {
    title: 'apply_capture_action',
    description: 'Record explicit approval of an Assistant proposal. A separate Assistant processor can project this into domain-specific state.',
    inputSchema: { proposalPath: z.string().optional(), capturePath: z.string().regex(/^pvr_[0-9A-HJKMNP-TV-Z]{26}$/).optional(), proposalId: z.string() },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }] },
  }, async ({ proposalPath, capturePath, proposalId }, extra) => {
    const auth = await requireGoogleAuth(extra);
    if (!auth.ok) return authError(extra, auth.reason);
    if (!ASSISTANT_VAULT_API_ENABLED) return apiDisabledError();
    const captureRecordId = capturePath || proposalPath;
    if (!captureRecordId?.startsWith('pvr_')) return { isError: true, content: [{ type: 'text', text: 'capturePath must be the capture recordId returned by capture_note.' }] };
    try {
      const result = await withVault((client) => approveProposal(captureRecordId, proposalId, { client }));
      return { content: [{ type: 'text', text: `Recorded approved proposal ${proposalId} for ${captureRecordId}.` }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Could not apply proposal: ${error.message}` }] };
    }
  });

  server.registerTool('get_today_plan', {
    title: 'get_today_plan',
    description: 'Read the current Assistant-owned Today projection from Personal Vault.',
    inputSchema: {},
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }] },
  }, async (_args, extra) => {
    const auth = await requireGoogleAuth(extra);
    if (!auth.ok) return authError(extra, auth.reason);
    if (!ASSISTANT_VAULT_API_ENABLED) return apiDisabledError();
    try {
      const projection = await withVault((client) => readTodayProjection(undefined, { client }));
      const tasks = (projection.tasks || []).filter((task) => task.status !== 'dropped').sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
      const structuredContent = { date: projection.date, generatedAt: projection.generatedAt || null, tasks, projects: groupTasks(tasks) };
      const commitmentText = tasks.length ? tasks.map((task) => `- ${task.area || task.projectId || 'inbox'}: ${task.title}`).join('\n') : '- No dated commitments are currently projected.';
      return { content: [{ type: 'text', text: `Today is ${projection.date}.\n\nCurrent commitments:\n${commitmentText}` }], structuredContent };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Could not read Today projection: ${error.message}` }] };
    }
  });

  server.registerTool('get_capture_review', {
    title: 'get_capture_review',
    description: 'Read Assistant-owned proposals for a capture record.',
    inputSchema: { capturePath: z.string().regex(/^pvr_[0-9A-HJKMNP-TV-Z]{26}$/) },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }] },
  }, async ({ capturePath }, extra) => {
    const auth = await requireGoogleAuth(extra);
    if (!auth.ok) return authError(extra, auth.reason);
    if (!ASSISTANT_VAULT_API_ENABLED) return apiDisabledError();
    try {
      const review = await withVault((client) => getProposal(capturePath, { client }));
      if (!review) return { isError: true, content: [{ type: 'text', text: `No review found for ${capturePath}.` }] };
      return { content: [{ type: 'text', text: `Review status: ${review.status}.\n\n${review.proposals.map((proposal, index) => `${index + 1}. ${proposal.label}`).join('\n')}` }], structuredContent: review };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Could not read capture review: ${error.message}` }] };
    }
  });

  server.registerTool('search_vault', {
    title: 'search_vault',
    description: 'Search generic Personal Vault records for prior captures, decisions and context.',
    inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(10).optional() },
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }] },
  }, async ({ query, limit = 5 }, extra) => {
    const auth = await requireGoogleAuth(extra);
    if (!auth.ok) return authError(extra, auth.reason);
    if (!ASSISTANT_VAULT_API_ENABLED) return apiDisabledError();
    try {
      const result = await withVault((client) => client.search(query, limit));
      const matches = result.matches.map((match) => ({ recordId: match.recordId, path: match.recordId, title: match.title, preview: match.snippet, score: match.score, sourceType: 'record' }));
      return { content: [{ type: 'text', text: matches.length ? `Found ${matches.length} vault matches.` : 'No vault matches found.' }], structuredContent: { query, matches } };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Could not search Personal Vault: ${error.message}` }] };
    }
  });

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) return void res.writeHead(400).end('Missing URL');
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  if (req.method === 'GET' && url.pathname === '/') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('Personal Assistant MCP server');
  if (req.method === 'GET' && url.pathname === '/healthz') return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ status: 'ok', server: 'personal-assistant', version: '0.2.0', mcpEndpoint: `${getPublicBaseUrl(req)}${MCP_PATH}`, vaultApi: ASSISTANT_VAULT_API_ENABLED ? 'enabled' : 'disabled', authentication: GOOGLE_AUTH_ENABLED ? 'oauth-required' : 'disabled' }));
  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
    const baseUrl = getPublicBaseUrl(req);
    return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ resource: baseUrl, authorization_servers: [GOOGLE_AUTHORIZATION_SERVER], scopes_supported: OAUTH_SCOPES, resource_documentation: `${baseUrl}/` }));
  }
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, mcp-session-id, authorization', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' });
    return void res.end();
  }
  if (url.pathname === MCP_PATH && ['POST', 'GET', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    const server = createPersonalAssistantServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('MCP request failed:', error);
      if (!res.headersSent) res.writeHead(500).end('Internal server error');
    }
    return;
  }
  res.writeHead(404).end('Not Found');
});

httpServer.listen(PORT, HOST, () => console.log(`Personal Assistant MCP listening on http://${HOST}:${PORT}${MCP_PATH}`));
