#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverVaultSourceChanges } from '../lib/vaultSourceInventory.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'vault-source-inventory-'));
  await mkdir(path.join(root, 'raw/2026/09'), { recursive: true });
  await mkdir(path.join(root, 'structured/imports'), { recursive: true });
  await mkdir(path.join(root, 'structured/plans'), { recursive: true });
  await mkdir(path.join(root, 'indexes'), { recursive: true });
  await mkdir(path.join(root, 'structured/plans'), { recursive: true });
  await writeFile(path.join(root, 'raw/2026/09/2026-09-23-cfs-update.md'), '---\ncreated: 2026-09-23\n---\n# CFS update\n');
  await writeFile(path.join(root, 'raw/2026/09/2026-09-23-audit-appendix.md'), '# Audit appendix\n');
  await writeFile(path.join(root, 'structured/imports/cv-export.json'), '{"source":"cv"}\n');
  await writeFile(path.join(root, 'indexes/captures.jsonl'), '{"path":"raw/2026/09/2026-09-23-cfs-update.md"}\n');
  await writeFile(path.join(root, 'structured/plans/planner-items.json'), '{"generatedAt":"volatile"}\n');
  await writeFile(path.join(root, 'structured/plans/daily-projection.json'), '{"generated":true}\n');
  return root;
}

test('discovers the same readable note with or without a capture index entry', async () => {
  const root = await fixture();
  try {
    const withoutIndex = await discoverVaultSourceChanges(root, { discoveredAt: '2026-09-23T00:00:00.000Z' });
    const withIndex = await discoverVaultSourceChanges(root, {
      captureIndexPaths: ['raw/2026/09/2026-09-23-cfs-update.md'],
      discoveredAt: '2026-09-23T00:00:00.000Z',
    });
    const sourcePath = 'raw/2026/09/2026-09-23-cfs-update.md';
    assert.deepEqual(withoutIndex.entries.map((entry) => entry.path), withIndex.entries.map((entry) => entry.path));
    assert.equal(withIndex.entries.find((entry) => entry.path === sourcePath)?.kind, 'human-note');
    assert.equal(withIndex.entries.find((entry) => entry.path === 'raw/2026/09/2026-09-23-audit-appendix.md')?.kind, 'audit-appendix');
    assert.equal(withIndex.entries.find((entry) => entry.path === 'structured/imports/cv-export.json')?.kind, 'machine-import');
    assert.equal(withIndex.entries.some((entry) => entry.path.startsWith('indexes/')), false);
    assert.equal(withIndex.entries.some((entry) => entry.path === 'structured/plans/planner-items.json'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('excludes generated outputs and symlinks, and reports removals only after a complete scan', async () => {
  const root = await fixture();
  const sourcePath = 'raw/2026/09/2026-09-23-cfs-update.md';
  try {
    await symlink('/tmp', path.join(root, 'raw/2026/09/escape-link'));
    const first = await discoverVaultSourceChanges(root, { now: '2026-09-23T00:00:00.000Z' });
    assert.equal(first.entries.some((entry) => entry.path === 'structured/plans/daily-projection.json'), false);
    assert.equal(first.coverage.excluded.generated.includes('structured/plans/daily-projection.json'), true);
    assert.equal(first.coverage.excluded.symlinks.includes('raw/2026/09/escape-link'), true);
    await unlink(path.join(root, sourcePath));
    const second = await discoverVaultSourceChanges(root, { previousEntries: first.entries, now: '2026-09-23T00:01:00.000Z' });
    assert.deepEqual(second.removals.map((entry) => entry.path), [sourcePath]);
    assert.equal(second.entries.find((entry) => entry.path === 'raw/2026/09/2026-09-23-audit-appendix.md')?.firstSeenAt, '2026-09-23T00:00:00.000Z');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deduplicates repeat scans, detects edits, and remains rebuildable from files', async () => {
  const root = await fixture();
  const sourcePath = 'raw/2026/09/2026-09-23-cfs-update.md';
  try {
    const first = await discoverVaultSourceChanges(root, { discoveredAt: '2026-09-23T00:00:00.000Z' });
    const repeat = await discoverVaultSourceChanges(root, { previousEntries: first.entries, discoveredAt: '2026-09-23T00:01:00.000Z' });
    assert.equal(repeat.changes.length, 0);
    assert.equal(new Set(repeat.entries.map((entry) => entry.path)).size, repeat.entries.length);

    await writeFile(path.join(root, sourcePath), '# CFS update\nEdited evidence\n');
    const edited = await discoverVaultSourceChanges(root, { previousEntries: first.entries, discoveredAt: '2026-09-23T00:02:00.000Z' });
    assert.deepEqual(edited.changes.map((entry) => [entry.path, entry.change]), [[sourcePath, 'changed']]);

    const rebuilt = await discoverVaultSourceChanges(root, { discoveredAt: '2026-09-23T00:03:00.000Z' });
    assert.equal(rebuilt.entries.some((entry) => entry.path === sourcePath), true, 'removing derived inventory cannot lose a source file');
    assert.equal(rebuilt.coverage.errors.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
