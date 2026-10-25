import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildProjectTimelineItems } from '../lib/projectTimeline.ts';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');

test('explicit routine tasks reach Planner without importing unrelated routine records', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'assistant-admin-'));
  try {
    await mkdir(path.join(root, 'structured/projects/routine'), { recursive: true });
    await mkdir(path.join(root, 'structured/routine'), { recursive: true });
    await mkdir(path.join(root, 'raw'), { recursive: true });
    await mkdir(path.join(root, 'incoming'), { recursive: true });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
    await writeFile(path.join(root, 'structured/projects/routine/current-plan.md'), `---
project: routine
title: Routine
---
### Check the requested correspondence
<!-- personal-vault-task
id: explicit-admin
status: in-progress
date: ${today}
-->
Prepare the reply; do not send.

### Previously completed notice
<!-- personal-vault-task
id: resolved-notice
status: done
completedDate: 2020-01-01
-->
No action required.
`);
    await writeFile(path.join(root, 'structured/routine/historical.json'), JSON.stringify({ title: 'Old calorie tracking', status: 'active' }));
    await execFileAsync(process.execPath, [path.join(projectRoot, 'scripts/generate-daily-projection.mjs')], {
      cwd: projectRoot, timeout: 20000,
      env: { ...process.env, PERSONAL_VAULT_ROOT: root, PERSONAL_ASSISTANT_CACHE_DIR: path.join(root, '.test-cache') },
    });
    const projection = JSON.parse(await readFile(path.join(root, 'structured/plans/daily-projection.json'), 'utf8'));
    assert.deepEqual(projection.tasks.map(item => item.id), ['explicit-admin']);
    assert.equal(projection.tasks[0].status, 'in-progress');
    assert.equal(projection.tasks[0].mutable, true);
    const index = JSON.parse(await readFile(path.join(root, 'structured/plans/planner-items.json'), 'utf8'));
    assert.equal(index.items.find(item => item.id === 'resolved-notice').status, 'done');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project task selection has no history or generic-next-step fallback', async () => {
  assert.deepEqual(buildProjectTimelineItems([], null), []);
  assert.deepEqual(buildProjectTimelineItems([], {}), []);
  const explicit = { id: 'known', priority: 100, status: 'done', title: 'Completed', planPath: 'plan.md' };
  assert.equal(buildProjectTimelineItems([explicit], null)[0].id, 'known');
  assert.equal(buildProjectTimelineItems([explicit], null)[0].status, 'done');
  const suggestions = buildProjectTimelineItems([], { project: 'test', title: 'Test', summary: 'Test', suggestedActions: [{ title: 'Review proposal', description: 'Not approved', horizon: 'review', target: 'Decision' }] });
  assert.equal(suggestions[0].status, 'suggested');
});
