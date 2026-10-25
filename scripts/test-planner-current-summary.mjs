#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_CURRENT_SUMMARY, selectCurrentPlannerSummary } from '../lib/plannerCurrentSummary.mjs';

const today = '2026-09-23';

test('an old dated snapshot cannot become the Planner headline merely because it exists', async () => {
  const oldSnapshot = {
    kind: 'vault-snapshot',
    status: 'active',
    date: '2026-08-27',
    title: 'Current State and 30-Day Adaptation Plan',
    summary: 'A historical plan must not become the current headline.',
    source: 'structured/plans/2026-08-27-current-state-and-30-day-adaptation-plan.md',
  };

  assert.equal(selectCurrentPlannerSummary([oldSnapshot], today), null);
  assert.equal(NO_CURRENT_SUMMARY, 'No current summary selected. Review recent changes before choosing today’s focus.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const generator = await readFile(path.join(root, 'scripts', 'generate-daily-projection.mjs'), 'utf8');
  assert.equal(generator.includes(oldSnapshot.source), false, 'the generator must not select the old snapshot by filename');
});

test('only an explicitly reviewed summary with source links can be selected', () => {
  const summary = {
    kind: 'planner-change-summary',
    status: 'reviewed',
    reviewedAt: '2026-09-23T10:00:00+10:00',
    summary: 'One reviewed outcome changed the selected focus.',
    sourceLinks: [{ path: 'raw/2026/09/outcome.md', label: 'Outcome' }],
  };

  assert.deepEqual(selectCurrentPlannerSummary([summary], today), summary);
  assert.equal(selectCurrentPlannerSummary([{ ...summary, sourceLinks: [] }], today), null);
});
