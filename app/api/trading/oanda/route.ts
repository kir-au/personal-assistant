import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const STRATEGY_PATH = path.join(VAULT_ROOT, 'structured', 'trading', 'oanda', 'soft-cycle.json');
const ACTIVITY_PATH = path.join(VAULT_ROOT, 'structured', 'trading', 'oanda', 'activity.jsonl');
const OANDA_STATUS_URL = process.env.OANDA_DASHBOARD_URL || 'http://127.0.0.1:3319/api/status';

async function readActivity() {
  try {
    const raw = await fs.readFile(ACTIVITY_PATH, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const event = JSON.parse(line);
          return event?.id && event?.occurredAt ? [event] : [];
        } catch {
          return [];
        }
      })
      .slice(-40)
      .reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readLiveStatus() {
  try {
    const response = await fetch(OANDA_STATUS_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Status endpoint returned ${response.status}`);
    return { live: await response.json(), liveError: null };
  } catch {
    return {
      live: null,
      liveError: 'Live OANDA tunnel is unavailable. Vault history remains available.',
    };
  }
}

export async function GET() {
  try {
    const [strategyRaw, activity, live] = await Promise.all([
      fs.readFile(STRATEGY_PATH, 'utf8'),
      readActivity(),
      readLiveStatus(),
    ]);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      strategy: JSON.parse(strategyRaw),
      activity,
      ...live,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'OANDA Trading data is not available.' }, { status: 500 });
  }
}
