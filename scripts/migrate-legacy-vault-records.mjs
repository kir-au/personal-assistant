#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PersonalVaultClient } from '../lib/personal-vault-client.mjs';
import { saveTodayProjection } from '../lib/assistant-vault-workflows.mjs';

const LEGACY_ROOT = path.resolve(process.env.LEGACY_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault'));
const APPLY = process.argv.includes('--apply');
const FILE_EXTENSIONS = new Set(['.md', '.json', '.jsonl']);
const ACTOR = { kind: 'migration', id: 'personal-assistant-legacy-import', displayName: 'Personal Assistant legacy migration' };
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function mutationId(key) {
  const bytes = createHash('sha256').update(key).digest();
  let suffix = '';
  for (let index = 0; index < 26; index += 1) suffix += ALPHABET[bytes[index % bytes.length] & 31];
  return `pvm_${suffix}`;
}

async function collect(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(fullPath, files);
    if (entry.isFile() && FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function titleFor(relativePath) {
  return path.basename(relativePath, path.extname(relativePath)).replace(/[-_]+/g, ' ').trim() || relativePath;
}

async function mutationFor(filePath) {
  const [content, details] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
  const relativePath = path.relative(LEGACY_ROOT, filePath).split(path.sep).join('/');
  const contentHash = sha256(content);
  const capturedAt = details.mtime.toISOString();
  const key = `assistant.legacy-import.${createHash('sha256').update(`${relativePath}\0${contentHash}`).digest('hex')}`;
  return {
    relativePath,
    bytes: Buffer.byteLength(content),
    mutation: {
      contractVersion: 'personal-vault/v1',
      mutationId: mutationId(key),
      requestedAt: capturedAt,
      requestedBy: ACTOR,
      idempotencyKey: key,
      approval: { kind: 'migration', approvedAt: capturedAt, approvedBy: ACTOR, evidenceRef: `legacy-filesystem:${relativePath}` },
      operation: {
        type: 'record.create',
        record: {
          privacy: 'private',
          title: titleFor(relativePath),
          content: { format: path.extname(relativePath).toLowerCase() === '.md' ? 'markdown' : 'plain-text', text: content, hash: contentHash },
          provenance: { origin: 'migration', capturedAt, capturedBy: ACTOR, sourceLocator: `legacy-filesystem:${relativePath}`, sourceHash: contentHash },
          assetRefs: [],
          metadata: { 'migration.source-kind': 'legacy-filesystem-record', 'migration.source-path': relativePath, 'migration.source-hash': contentHash },
        },
      },
      provenance: { origin: 'migration', capturedAt, capturedBy: ACTOR, sourceLocator: `legacy-filesystem:${relativePath}`, sourceHash: contentHash },
    },
  };
}

async function main() {
  const roots = [path.join(LEGACY_ROOT, 'raw'), path.join(LEGACY_ROOT, 'structured')];
  const files = (await Promise.all(roots.map((root) => collect(root)))).flat().sort();
  const entries = await Promise.all(files.map(mutationFor));
  const byteCount = entries.reduce((total, entry) => total + entry.bytes, 0);
  console.log(`${APPLY ? 'Applying' : 'Dry run:'} ${entries.length} readable legacy records (${byteCount} bytes) from ${LEGACY_ROOT}.`);
  if (!APPLY) {
    console.log('No records were written. Re-run with --apply only after the local Vault MCP companion is healthy.');
    return;
  }

  const client = new PersonalVaultClient();
  try {
    await client.connect();
    const existingSources = new Set();
    let cursor;
    do {
      const page = await client.list({ ...(cursor ? { cursor } : {}), state: 'active', limit: 100 });
      for (const record of page.records) {
        const sourcePath = record.metadata['migration.source-path'];
        const sourceHash = record.metadata['migration.source-hash'];
        if (typeof sourcePath === 'string' && typeof sourceHash === 'string') existingSources.add(`${sourcePath}\0${sourceHash}`);
      }
      cursor = page.hasMore ? page.nextCursor : null;
    } while (cursor);
    let created = 0;
    let alreadyPresent = 0;
    for (const entry of entries) {
      const sourcePath = entry.mutation.operation.record.metadata['migration.source-path'];
      const sourceHash = entry.mutation.operation.record.metadata['migration.source-hash'];
      if (existingSources.has(`${sourcePath}\0${sourceHash}`)) {
        alreadyPresent += 1;
        continue;
      }
      const result = await client.create(entry.mutation);
      if (result.replayed) alreadyPresent += 1;
      else created += 1;
    }
    const projectionPath = path.join(LEGACY_ROOT, 'structured', 'plans', 'daily-projection.json');
    try {
      const projection = JSON.parse(await readFile(projectionPath, 'utf8'));
      await saveTodayProjection(projection, { client, migration: true });
      console.log(`Imported ${created} records; ${alreadyPresent} were already present. Imported the current Today projection as an Assistant-owned projection record.`);
    } catch (error) {
      console.log(`Imported ${created} records; ${alreadyPresent} were already present. Today projection was not imported: ${error.message}`);
    }
  } finally {
    await client.close().catch(() => {});
  }
}

await main();
