#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { groupPlannerTasks } from '../lib/plannerSections.ts';

const today = '2026-09-23';
const tomorrow = '2026-09-24';

function ids(tasks) {
  return tasks.map((task) => task.id);
}

test('groups active tasks once, preserving explicit dates over stale horizons', () => {
  const tasks = [
    { id: 'today', status: 'planned', date: today },
    { id: 'tomorrow', status: 'planned', date: tomorrow },
    { id: 'future', status: 'planned', date: '2026-10-01' },
    { id: 'future-stale-backlog', status: 'planned', date: '2026-10-02', horizon: 'backlog' },
    { id: 'undated', status: 'planned' },
    { id: 'backlog', status: 'planned', horizon: 'backlog' },
    { id: 'waiting', status: 'waiting', date: today },
    { id: 'paused', status: 'paused', date: today },
    { id: 'late', status: 'planned', date: '2026-09-22' },
    { id: 'review', status: 'review', date: '2026-10-03' },
    { id: 'explicit-review', status: 'planned', date: '2026-10-04', needsPlannerReview: true },
    { id: 'done', status: 'done', date: today },
    { id: 'archived', status: 'archived', date: today },
  ];

  const before = structuredClone(tasks);
  const sections = groupPlannerTasks(tasks, today, tomorrow);

  assert.deepEqual(ids(sections.today), ['today']);
  assert.deepEqual(ids(sections.tomorrow), ['tomorrow']);
  assert.deepEqual(ids(sections.future), ['future', 'future-stale-backlog']);
  assert.deepEqual(ids(sections.waiting), ['waiting']);
  assert.deepEqual(ids(sections.later), ['undated', 'backlog', 'paused']);
  assert.deepEqual(ids(sections.review), ['late', 'review', 'explicit-review']);
  assert.deepEqual(tasks, before, 'display grouping must not mutate source tasks');

  const visible = Object.values(sections).flat();
  assert.equal(new Set(visible.map((task) => task.id)).size, visible.length, 'a task must appear in only one section');
  assert.equal(visible.some((task) => task.id === 'done' || task.id === 'archived'), false);
});

test('uses horizons only when an active task has no explicit date', () => {
  const sections = groupPlannerTasks([
    { id: 'horizon-today', status: 'planned', horizon: 'today' },
    { id: 'horizon-tomorrow', status: 'planned', horizon: 'tomorrow' },
    { id: 'unknown-horizon', status: 'planned', horizon: 'this-month' },
  ], today, tomorrow);

  assert.deepEqual(ids(sections.today), ['horizon-today']);
  assert.deepEqual(ids(sections.tomorrow), ['horizon-tomorrow']);
  assert.deepEqual(ids(sections.later), ['unknown-horizon']);
});
