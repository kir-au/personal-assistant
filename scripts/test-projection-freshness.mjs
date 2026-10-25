#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectionFreshness } from '../lib/projectionFreshness.mjs';

test('source changes invalidate a same-day projection without treating scan failures as fresh', () => {
  const projection = { sourceInventory: { sourceVersion: 'before' } };
  assert.deepEqual(projectionFreshness(projection, { status: 'fresh', inventory: { sourceVersion: 'before' } }), { state: 'fresh', stale: false, checkedAt: null, reason: null });
  assert.equal(projectionFreshness(projection, { status: 'fresh', inventory: { sourceVersion: 'after' } }).state, 'source-changed');
  assert.equal(projectionFreshness(projection, { status: 'scan-error', inventory: { sourceVersion: 'after' } }).state, 'scan-error');
});
