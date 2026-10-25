#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectTimelineItems } from '../lib/projectTimeline.ts';

test('historical conversations and registry next-step copy cannot create tasks', () => {
  const referenceOnly = {
    project: 'travel', title: 'Travel', summary: 'Recorded context',
    next: 'Invent a next useful step',
    conversations: [{ conversationId: 'old', vaultDate: '2020-01-01', title: 'Old idea' }],
  };
  const before = structuredClone(referenceOnly);
  assert.deepEqual(buildProjectTimelineItems([], referenceOnly), []);
  assert.deepEqual(referenceOnly, before);
});

test('empty project has no synthetic P100 item', () => {
  assert.deepEqual(buildProjectTimelineItems([], null), []);
});

test('explicit commitments retain their source, dates, status and priority', () => {
  const plan = [{ id: 'approved', title: 'Agreed work', status: 'waiting', priority: 80,
    date: '2026-10-21', detail: 'Verified context', why: 'User decision', outcome: 'Specific result',
    planPath: 'structured/projects/demo/current-plan.md' }];
  const before = structuredClone(plan);
  const items = buildProjectTimelineItems(plan, {
    project: 'demo', title: 'Demo', summary: 'Suggestion',
    suggestedActions: [{ title: 'Unselected proposal', horizon: 'today', description: 'Not approved', target: 'Unknown' }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'approved');
  assert.equal(items[0].date, '2026-10-21');
  assert.equal(items[0].status, 'waiting');
  assert.equal(items[0].priority, 80);
  assert.deepEqual(items[0].sourcePaths, [plan[0].planPath]);
  assert.equal(items[0].mutable, true);
  assert.deepEqual(plan, before);
});

test('existing insight proposals remain suggestions and are not mutable commitments', () => {
  const items = buildProjectTimelineItems([], {
    project: 'demo', title: 'Demo', summary: 'Proposal',
    suggestedActions: [{ title: 'A proposal', horizon: 'later', description: 'Review it', target: 'Decision' }],
  });
  assert.equal(items[0].status, 'suggested');
  assert.notEqual(items[0].mutable, true);
});

test('an unavailable current-plan input must not fall back to guessed suggestions', () => {
  const insights = { project: 'demo', title: 'Demo', summary: 'Proposal',
    suggestedActions: [{ title: 'A proposal', horizon: 'today', description: 'Review it', target: 'Decision' }] };
  assert.deepEqual(buildProjectTimelineItems([], insights, { planUnavailable: true }), []);
});

test('backlog display preserves stored priorities and does not reorder source evidence', () => {
  const insights = { project: 'demo', title: 'Demo', summary: 'Existing backlog',
    backlog: { title: 'Review', goal: 'Review', whyThisMatters: 'Evidence', items: [
      { id: 'low', title: 'Low', status: 'review', priority: 5, horizon: 'later', why: 'Source',
        notDoneBecause: 'Not approved', desiredOutcome: 'Decision', sourcePaths: ['raw/a.md'] },
      { id: 'high', title: 'High', status: 'review', priority: 10, horizon: 'later', why: 'Source',
        notDoneBecause: 'Not approved', desiredOutcome: 'Decision', sourcePaths: ['raw/b.md'] },
    ] } };
  const before = structuredClone(insights);
  assert.deepEqual(buildProjectTimelineItems([], insights).map(x => x.id), ['high', 'low']);
  assert.deepEqual(insights, before);
});
