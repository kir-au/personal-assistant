#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startSourceInventoryLifecycle } from '../lib/sourceInventoryLifecycle.mjs';
import { refreshSourceInventory } from '../lib/sourceInventoryWorker.mjs';

async function waitForProjection(root, predicate, description, timeoutMs = 20_000) {
  const projectionPath = path.join(root, 'structured/plans/daily-projection.json');
  const endAt = Date.now() + timeoutMs;
  let lastProjection = null;
  while (Date.now() < endAt) {
    try {
      lastProjection = JSON.parse(await readFile(projectionPath, 'utf8'));
      if (predicate(lastProjection)) return lastProjection;
    } catch { /* The fixture projection may not exist until the first background pass. */ }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  assert.fail(`Timed out waiting for ${description}; last projection: ${JSON.stringify(lastProjection)}`);
}

async function monitorProjectionJson(root) {
  const projectionPath = path.join(root, 'structured/plans/daily-projection.json');
  let active = true;
  const parseErrors = [];
  const reader = (async () => {
    while (active) {
      try { JSON.parse(await readFile(projectionPath, 'utf8')); }
      catch (error) {
        if (error?.code !== 'ENOENT') parseErrors.push(error instanceof Error ? error.message : String(error));
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
  return async () => {
    active = false;
    await reader;
    return parseErrors;
  };
}

test('local lifecycle catches startup, external edits, missed watcher roots, and restart changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assistant-lifecycle-vault-'));
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'assistant-lifecycle-cache-'));
  const priorRoot = process.env.PERSONAL_VAULT_ROOT;
  const priorCache = process.env.PERSONAL_ASSISTANT_CACHE_DIR;
  let lifecycle;
  try {
    process.env.PERSONAL_VAULT_ROOT = root;
    process.env.PERSONAL_ASSISTANT_CACHE_DIR = cacheDirectory;
    await mkdir(path.join(root, 'raw'), { recursive: true });
    await mkdir(path.join(root, 'structured/plans'), { recursive: true });
    await mkdir(path.join(root, 'structured/projects'), { recursive: true });
    await mkdir(path.join(root, 'structured/health'), { recursive: true });
    await writeFile(path.join(root, 'raw/start.md'), '# Start\n');

    lifecycle = startSourceInventoryLifecycle({
      root,
      projectRoot: process.cwd(),
      debounceMs: 35,
      recoveryMs: 1200,
    });
    const started = await waitForProjection(root, (projection) =>
      projection.sourceInventory?.entries?.some((entry) => entry.path === 'raw/start.md'), 'startup projection');
    assert.ok(started.sourceInventory.sourceVersion);
    const stable = await refreshSourceInventory(root);
    assert.equal(stable.inventory.sourceVersion, started.sourceInventory.sourceVersion,
      `a generated projection must not change its own source version: ${JSON.stringify(stable.inventory.entries.map((entry) => entry.path))}`);

    const stopProjectionMonitor = await monitorProjectionJson(root);
    const burstPaths = ['external-edit.md', 'burst-two.md', 'burst-three.md'];
    await Promise.all(burstPaths.map((name) => writeFile(path.join(root, 'raw', name), `# ${name}\n`)));
    const edited = await waitForProjection(root, (projection) =>
      burstPaths.every((name) => projection.sourceInventory?.entries?.some((entry) => entry.path === `raw/${name}`)), 'debounced external file burst');
    const parseErrors = await stopProjectionMonitor();
    assert.deepEqual(parseErrors, [], 'readers must never observe partially written projection JSON');
    const generatedAt = edited.generatedAt;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const stableProjection = JSON.parse(await readFile(path.join(root, 'structured/plans/daily-projection.json'), 'utf8'));
    assert.equal(stableProjection.generatedAt, generatedAt, 'one debounced burst must not trigger redundant follow-up generation');

    // This root did not exist when fs.watch was attached; the periodic pass must recover it.
    await mkdir(path.join(root, 'incoming'), { recursive: true });
    await writeFile(path.join(root, 'incoming/recovered.txt'), 'Recovered after missed watch setup.\n');
    const recovered = await waitForProjection(root, (projection) =>
      projection.sourceInventory?.entries?.some((entry) => entry.path === 'incoming/recovered.txt'), 'periodic missed-event recovery');
    assert.ok(recovered.sourceInventory.sourceVersion);

    await lifecycle.stop();
    lifecycle = startSourceInventoryLifecycle({ root, projectRoot: process.cwd(), debounceMs: 35, recoveryMs: 1200 });
    await writeFile(path.join(root, 'raw/after-restart.md'), '# After restart\n');
    const restarted = await waitForProjection(root, (projection) =>
      projection.sourceInventory?.entries?.some((entry) => entry.path === 'raw/after-restart.md'), 'restart recovery');
    assert.ok(restarted.generatedAt);
  } finally {
    await lifecycle?.stop();
    if (priorRoot === undefined) delete process.env.PERSONAL_VAULT_ROOT;
    else process.env.PERSONAL_VAULT_ROOT = priorRoot;
    if (priorCache === undefined) delete process.env.PERSONAL_ASSISTANT_CACHE_DIR;
    else process.env.PERSONAL_ASSISTANT_CACHE_DIR = priorCache;
    await rm(root, { recursive: true, force: true });
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
