import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const PLANNER_ITEMS_PATH = path.join(VAULT_ROOT, 'structured', 'plans', 'planner-items.json');
const DAILY_PROJECTION_PATH = path.join(VAULT_ROOT, 'structured', 'plans', 'daily-projection.json');
const PROJECTS_ROOT = path.join(VAULT_ROOT, 'structured', 'projects');
const execFileAsync = promisify(execFile);

type PlannerItemAction = 'done' | 'move-tomorrow' | 'deprioritize' | 'drop';

interface PlannerItem {
  id: string;
  status?: string;
  date?: string;
  horizon?: string;
  priority?: number;
  completedDate?: string;
  updatedAt?: string;
}

function parseMetadata(block: string) {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':');
      return separator === -1
        ? [line, ''] as const
        : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
    });
}

function applyMetadataChanges(
  metadataBlock: string,
  updates: Record<string, string | undefined>
) {
  const entries = parseMetadata(metadataBlock);
  const existing = new Map(entries);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) existing.delete(key);
    else existing.set(key, value);
  }

  const orderedKeys = [
    ...entries.map(([key]) => key).filter((key) => existing.has(key)),
    ...Array.from(existing.keys()).filter((key) => !entries.some(([existingKey]) => existingKey === key)),
  ];
  return orderedKeys.map((key) => `${key}: ${existing.get(key)}`).join('\n');
}

async function updateProjectPlanItem(itemId: string, updates: Record<string, string | undefined>) {
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const planPath = path.join(PROJECTS_ROOT, entry.name, 'current-plan.md');
    let markdown: string;
    try {
      markdown = await fs.readFile(planPath, 'utf-8');
    } catch {
      continue;
    }

    let updated = false;
    const nextMarkdown = markdown.replace(/<!--\s*personal-vault-task\n([\s\S]*?)\n-->/g, (full, metadataBlock: string) => {
      const metadata = new Map(parseMetadata(metadataBlock));
      if (metadata.get('id') !== itemId) return full;
      updated = true;
      return `<!-- personal-vault-task\n${applyMetadataChanges(metadataBlock, updates)}\n-->`;
    });

    if (updated) {
      await fs.writeFile(planPath, nextMarkdown, 'utf-8');
      return true;
    }
  }
  return false;
}

function sydneyDate(offset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function regenerateProjection() {
  const scriptPath = path.join(process.cwd(), 'scripts', 'generate-daily-projection.mjs');
  await execFileAsync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
}

export async function PATCH(request: Request) {
  try {
    const { itemId, action } = await request.json() as { itemId?: string; action?: PlannerItemAction };
    if (!itemId || !['done', 'move-tomorrow', 'deprioritize', 'drop'].includes(String(action))) {
      return NextResponse.json({ error: 'A valid itemId and action are required.' }, { status: 400 });
    }

    const store = JSON.parse(await fs.readFile(PLANNER_ITEMS_PATH, 'utf-8')) as { items?: PlannerItem[] };
    const item = store.items?.find((candidate) => candidate.id === itemId);
    if (!item) return NextResponse.json({ error: 'Planner item not found.' }, { status: 404 });

    const today = sydneyDate();
    let updates: Record<string, string | undefined>;
    if (action === 'done') {
      updates = { status: 'done', date: today, horizon: 'today', completedDate: today };
    } else if (action === 'move-tomorrow') {
      updates = { status: 'planned', date: sydneyDate(1), horizon: 'tomorrow', completedDate: undefined };
    } else if (action === 'deprioritize') {
      updates = {
        status: 'review',
        horizon: 'backlog',
        priority: String(Math.min(item.priority || 50, 40)),
        date: undefined,
        completedDate: undefined,
      };
    } else {
      updates = { status: 'archived', horizon: 'archived', date: undefined, completedDate: undefined };
    }

    const updated = await updateProjectPlanItem(itemId, updates);
    if (!updated) return NextResponse.json({ error: 'Project plan item not found.' }, { status: 404 });
    await regenerateProjection();
    const projection = JSON.parse(await fs.readFile(DAILY_PROJECTION_PATH, 'utf-8'));
    const refreshedStore = JSON.parse(await fs.readFile(PLANNER_ITEMS_PATH, 'utf-8')) as { items?: PlannerItem[] };
    const refreshedItem = refreshedStore.items?.find((candidate) => candidate.id === itemId);

    return NextResponse.json({ ok: true, item: refreshedItem, projection });
  } catch (error) {
    return NextResponse.json({
      error: 'Unable to update the planner item.',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
