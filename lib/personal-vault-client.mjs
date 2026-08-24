import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

const recordIdSchema = z.string().regex(/^pvr_[0-9A-HJKMNP-TV-Z]{26}$/);
const assetIdSchema = z.string().regex(/^pva_[0-9A-HJKMNP-TV-Z]{26}$/);
const recordSchema = z.object({
  contractVersion: z.literal('personal-vault/v1'),
  recordId: recordIdSchema,
  revision: z.number().int().positive(),
  state: z.enum(['active', 'archived', 'trashed']),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.object({ kind: z.string(), id: z.string(), displayName: z.string().optional() }).passthrough(),
  privacy: z.enum(['private', 'restricted', 'shared', 'public']),
  title: z.string().optional(),
  content: z.object({ format: z.enum(['markdown', 'plain-text']), text: z.string(), hash: z.string() }).passthrough(),
  provenance: z.object({ origin: z.string(), capturedAt: z.string(), capturedBy: z.object({ kind: z.string(), id: z.string() }).passthrough() }).passthrough(),
  assetRefs: z.array(z.object({ assetId: assetIdSchema, role: z.string() }).passthrough()),
  metadata: z.record(z.string(), z.unknown()),
}).passthrough();
const assetSchema = z.object({ assetId: assetIdSchema, contentHash: z.string(), byteLength: z.number().int().nonnegative() }).passthrough();
const assetGetSchema = z.object({ asset: assetSchema, payload: z.object({ encoding: z.literal('base64'), dataBase64: z.string() }) });
const mutationResultSchema = z.object({ record: recordSchema, auditEvent: z.object({ action: z.string() }).passthrough(), asset: assetSchema.optional(), replayed: z.boolean() }).passthrough();
const recordListSchema = z.object({ contractVersion: z.literal('personal-vault/v1'), records: z.array(recordSchema), nextCursor: z.string(), hasMore: z.boolean() });
const searchSchema = z.object({ query: z.string(), matches: z.array(z.object({ recordId: recordIdSchema }).passthrough()) });
const changeFeedSchema = z.object({ contractVersion: z.literal('personal-vault/v1'), events: z.array(z.object({ eventId: z.string() }).passthrough()), nextCursor: z.string(), hasMore: z.boolean() });

export class PersonalVaultClientError extends Error {
  constructor(message, { code = 'vault_client_error', cause, tool } = {}) {
    super(message, { cause });
    this.name = 'PersonalVaultClientError';
    this.code = code;
    this.tool = tool;
  }
}

function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

export class PersonalVaultClient {
  constructor({
    url,
    timeoutMs = Number(process.env.PERSONAL_VAULT_MCP_TIMEOUT_MS || 5000),
    token = process.env.PERSONAL_VAULT_MCP_TOKEN || '',
  } = {}) {
    const configuredUrl = url || process.env.PERSONAL_VAULT_MCP_URL || (process.env.NODE_ENV === 'production' ? null : 'http://127.0.0.1:8788/mcp');
    if (!configuredUrl) throw new PersonalVaultClientError('PERSONAL_VAULT_MCP_URL must be configured outside local development.', { code: 'configuration_error' });
    this.url = new URL(configuredUrl);
    this.timeoutMs = timeoutMs;
    this.token = token;
    this.client = null;
  }

  async connect() {
    if (this.client) return this;
    const headers = this.token ? { authorization: `Bearer ${this.token}` } : undefined;
    const client = new Client({ name: 'personal-assistant-vault-client', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(this.url, { requestInit: { headers } });
    try {
      await client.connect(transport, { signal: timeoutSignal(this.timeoutMs) });
      this.client = client;
      return this;
    } catch (cause) {
      await client.close().catch(() => {});
      throw new PersonalVaultClientError(`Unable to connect to Personal Vault MCP at ${this.url.href}`, { code: 'connection_failed', cause });
    }
  }

  async close() {
    const client = this.client;
    this.client = null;
    if (client) await client.close();
  }

  async call(name, args, schema) {
    await this.connect();
    try {
      const result = await this.client.callTool({ name, arguments: args }, undefined, { signal: timeoutSignal(this.timeoutMs) });
      if (result.isError) {
        const message = result.content?.find((item) => item.type === 'text')?.text || `Personal Vault tool ${name} failed.`;
        throw new PersonalVaultClientError(message, { code: 'tool_error', tool: name });
      }
      return schema.parse(result.structuredContent);
    } catch (cause) {
      if (cause instanceof PersonalVaultClientError) throw cause;
      throw new PersonalVaultClientError(`Personal Vault tool ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { code: 'request_failed', cause, tool: name });
    }
  }

  create(mutation) {
    return this.call('vault.records.create', { mutation }, mutationResultSchema);
  }

  get(recordId) {
    return this.call('vault.records.get', { recordId }, z.object({ record: recordSchema })).then((result) => result.record);
  }

  list(options = {}) {
    return this.call('vault.records.list', options, recordListSchema);
  }

  search(query, limit = 20) {
    return this.call('vault.records.search', { query, limit }, searchSchema);
  }

  attachAsset(mutation) {
    return this.call('vault.assets.attach', { mutation }, mutationResultSchema);
  }

  getAsset(assetId) {
    return this.call('vault.assets.get', { assetId }, assetGetSchema);
  }

  appendMutation(mutation) {
    return this.call('vault.mutations.append', { mutation }, mutationResultSchema);
  }

  listChanges(cursor, limit = 50) {
    return this.call('vault.changes.list', { ...(cursor ? { cursor } : {}), limit }, changeFeedSchema);
  }
}

export async function withPersonalVaultClient(options, operation) {
  const client = new PersonalVaultClient(options);
  try {
    await client.connect();
    return await operation(client);
  } finally {
    await client.close().catch(() => {});
  }
}
