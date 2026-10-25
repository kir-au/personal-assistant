#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSourceInventoryCache, refreshSourceInventory } from '../lib/sourceInventoryWorker.mjs';

test('cache is disposable, reuses unchanged metadata, and coalesces concurrent refreshes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'source-worker-vault-'));
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'source-worker-cache-'));
  try {
    await mkdir(path.join(root, 'raw/2026/09'), { recursive: true });
    await writeFile(path.join(root, 'raw/2026/09/note.md'), '# Note\n');
    const first = await refreshSourceInventory(root, { cacheDirectory, verifyContentAfterMs: 86_400_000 });
    assert.equal(first.status, 'fresh');
    assert.equal(first.inventory.coverage.contentReads, 1);
    const cached = await readSourceInventoryCache(root, { cacheDirectory });
    assert.equal(cached?.inventory.entries.length, 1);

    const [second, parallel] = await Promise.all([
      refreshSourceInventory(root, { cacheDirectory, verifyContentAfterMs: 86_400_000 }),
      refreshSourceInventory(root, { cacheDirectory, verifyContentAfterMs: 86_400_000 }),
    ]);
    assert.equal(second.inventory.sourceVersion, parallel.inventory.sourceVersion);
    assert.equal(second.inventory.coverage.metadataReused, 1);

    await rm(cacheDirectory, { recursive: true, force: true });
    const rebuilt = await refreshSourceInventory(root, { cacheDirectory, verifyContentAfterMs: 86_400_000 });
    assert.equal(rebuilt.cache, 'rebuilt');
    assert.equal(rebuilt.inventory.entries.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
