import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { refreshSourceInventory } from '@/lib/sourceInventoryWorker.mjs';
import { projectionFreshness } from '@/lib/projectionFreshness.mjs';

const VAULT_ROOT = path.resolve(process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault'));
const DAILY_PROJECTION_PATH = path.join(VAULT_ROOT, 'structured', 'plans', 'daily-projection.json');
const CURRENT_PROJECTION_VERSION = 3;
const execFileAsync = promisify(execFile);
let regeneration: Promise<void> | null = null;

export const runtime = 'nodejs';

function getSydneyDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function readDailyProjection() {
  try {
    const raw = await fs.readFile(DAILY_PROJECTION_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fallbackProjection() {
  return NextResponse.json({
    title: 'Weekly plan from Personal Vault',
    weekFocus: 'Use the vault as the source of truth, then generate a small set of tasks that can move the day and week forward.',
    generatedFrom: [
      'Raw conversations and check-ins',
      'Structured decisions and long-term goals',
      'Project summaries and recent changes',
      'Health, family, and energy constraints',
    ],
    tasks: [
      {
        id: 'product-dashboard-boundary',
        title: 'Separate Personal Vault as headless memory backend and keep dashboard as the human surface.',
        area: 'Product',
        status: 'planned',
        source: 'Vault direction and current architecture discussion',
      },
      {
        id: 'product-planner-projection',
        title: 'Replace standalone Planner ownership with generated week/today projection.',
        area: 'Product',
        status: 'suggested',
        source: 'Planner state/plan.json concept',
      },
      {
        id: 'health-energy-baseline',
        title: 'Keep the day plan energy-aware: food, hydration, recovery, and small execution block.',
        area: 'Health',
        status: 'suggested',
        source: 'Operating profile and morning resurfacing notes',
      },
      {
        id: 'family-visible',
        title: 'Keep family/life context visible even when the main task is product work.',
        area: 'Family',
        status: 'suggested',
        source: 'Today brief and day map requirements',
      },
      {
        id: 'admin-backup-boundary',
        title: 'Define backup/export and access-control model before broader agent write access.',
        area: 'Admin',
        status: 'suggested',
        source: 'Personal Vault access-control decision',
      },
    ],
  });
}

function isProjectionStale(projection: any) {
  return projection?.dates?.today !== getSydneyDate()
    || projection?.projectionVersion !== CURRENT_PROJECTION_VERSION;
}

async function regenerateDailyProjection() {
  if (regeneration) return regeneration;
  const scriptPath = path.join(process.cwd(), 'scripts', 'generate-daily-projection.mjs');
  regeneration = execFileAsync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  }).then(() => undefined).finally(() => { regeneration = null; });
  return regeneration;
}

export async function GET() {
  let projection = await readDailyProjection();
  const inventoryResult = await refreshSourceInventory(VAULT_ROOT).catch(() => ({ status: 'scan-error' }));
  let freshness = projectionFreshness(projection, inventoryResult);
  if (!projection || isProjectionStale(projection) || (freshness.stale && freshness.state === 'source-changed')) {
    try {
      await regenerateDailyProjection();
      projection = await readDailyProjection();
      freshness = projectionFreshness(projection, inventoryResult);
    } catch (error) {
      freshness = {
        ...freshness,
        state: 'regeneration-error',
        stale: true,
        reason: 'Source state was checked, but the Planner projection could not be regenerated.',
      };
      console.error('Failed to refresh daily projection', error);
    }
  }

  if (projection) {
    return NextResponse.json({
      ...projection,
      sourcePath: 'structured/plans/daily-projection.json',
      freshness,
    });
  }

  return fallbackProjection();
}
