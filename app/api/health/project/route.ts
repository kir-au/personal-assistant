import { NextResponse } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';
import { readHealthPlans } from '@/lib/healthPlans';
import { readHealthConnectActivityLog } from '@/lib/healthConnect';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const ACTIVITY_LOG_PATH = path.join(VAULT_ROOT, 'structured', 'health', 'activity-log.jsonl');
const ACTIVITY_LOOKBACK_DAYS = 7;

function getSydneyDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateValue: string, offset: number) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const health = await readHealthPlans();
    const primaryPlan = health.plans.find((plan) => plan.projectId === 'shoulder-rehab') || health.plans[0];
    const activityLog = await readActivityLog();

    return NextResponse.json({
      ...(primaryPlan || {}),
      title: 'Health plans',
      goal: primaryPlan?.goal || 'Keep current health commitments visible and realistic.',
      rule: primaryPlan?.rule || 'Progress only when body response is green.',
      exerciseKey: health.plans.flatMap((plan) => plan.exerciseKey),
      notes: primaryPlan?.notes || [],
      plans: health.plans,
      days: health.days,
      todayDate: health.todayDate,
      today: health.today,
      upcoming: health.upcoming,
      activityLog,
      sourcePath: 'structured/health/*-plan.json',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Health project plan not available',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 404 }
    );
  }
}

async function readActivityLog() {
  try {
    const raw = await fsp.readFile(ACTIVITY_LOG_PATH, 'utf-8');
    const cutoff = addDays(getSydneyDate(), -(ACTIVITY_LOOKBACK_DAYS - 1));
    const manualEntries = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => String(entry.date || '') >= cutoff);
    const syncedEntries = await readHealthConnectActivityLog({ since: cutoff });
    return [...manualEntries, ...syncedEntries]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.source || '').localeCompare(String(b.source || '')));
  } catch {
    return readHealthConnectActivityLog({ since: addDays(getSydneyDate(), -(ACTIVITY_LOOKBACK_DAYS - 1)) });
  }
}
