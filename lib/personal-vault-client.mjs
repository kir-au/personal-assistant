import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class PersonalVaultClient {
  constructor({ url = process.env.PERSONAL_VAULT_MCP_URL || 'http://127.0.0.1:8788/mcp', timeoutMs = 5000 } = {}) {
    this.url = new URL(url);
    this.timeoutMs = timeoutMs;
    this.client = null;
  }

  async connect() {
    if (this.client) return this;
    const client = new Client({ name: 'personal-assistant', version: '0.2.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(this.url), { signal: AbortSignal.timeout(this.timeoutMs) });
      this.client = client;
      return this;
    } catch (error) {
      await client.close().catch(() => {});
      throw new Error(`Personal Vault is unavailable at ${this.url.href}: ${error.message}`);
    }
  }

  async close() {
    const client = this.client;
    this.client = null;
    await client?.close();
  }

  async call(name, args) {
    await this.connect();
    const result = await this.client.callTool({ name, arguments: args }, undefined, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (result.isError) throw new Error(result.content?.find((item) => item.type === 'text')?.text || `${name} failed.`);
    return result.structuredContent;
  }

  list(path = '', recursive = false, limit = 200) { return this.call('vault_files_list', { path, recursive, limit }); }
  read(path) { return this.call('vault_files_read', { path }); }
  create(path, content) { return this.call('vault_files_create', { path, content }); }
  update(path, content) { return this.call('vault_files_update', { path, content }); }
  search(query, limit = 20) { return this.call('vault_files_search', { query, limit }); }
  attach(markdownPath, name, dataBase64) { return this.call('vault_files_attach', { markdownPath, name, dataBase64 }); }
}
