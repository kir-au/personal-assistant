import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverVaultSourceChanges, resolveVaultRoot, SOURCE_INVENTORY_VERSION } from './vaultSourceInventory.mjs';

const inflight = new Map();
const cacheKey = (root) => createHash('sha256').update(root).digest('hex').slice(0, 20);
const defaultCacheDirectory = () => process.env.PERSONAL_ASSISTANT_CACHE_DIR || path.join(os.homedir(), '.personal-assistant', 'source-inventory');

async function cachePath(root, cacheDirectory = defaultCacheDirectory()) {
  return path.join(cacheDirectory, `v${SOURCE_INVENTORY_VERSION}-${cacheKey(root)}.json`);
}

export async function readSourceInventoryCache(root, { cacheDirectory } = {}) {
  const resolvedRoot = await resolveVaultRoot(root);
  try {
    const cached = JSON.parse(await readFile(await cachePath(resolvedRoot, cacheDirectory), 'utf8'));
    if (cached.schemaVersion !== SOURCE_INVENTORY_VERSION || cached.root !== resolvedRoot) return null;
    return cached;
  } catch { return null; }
}

async function writeCache(root, inventory, cacheDirectory) {
  const target = await cachePath(root, cacheDirectory);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify({ schemaVersion: SOURCE_INVENTORY_VERSION, root, savedAt: new Date().toISOString(), inventory }, null, 2));
  await rename(temporary, target);
}

export async function refreshSourceInventory(root, options = {}) {
  const resolvedRoot = await resolveVaultRoot(root);
  const key = `${resolvedRoot}:${options.cacheDirectory || defaultCacheDirectory()}`;
  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    const cached = await readSourceInventoryCache(resolvedRoot, options);
    const inventory = await discoverVaultSourceChanges(resolvedRoot, {
      previousEntries: cached?.inventory?.entries || [],
      verifyContentAfterMs: options.verifyContentAfterMs,
    });
    // Keep the last complete cache if coverage is partial, so missing paths cannot
    // become removals or a false-fresh projection.
    if (inventory.coverage.complete) await writeCache(resolvedRoot, inventory, options.cacheDirectory);
    return { inventory, cache: cached ? 'updated' : 'rebuilt', status: inventory.coverage.complete ? 'fresh' : 'scan-error' };
  })().finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}
