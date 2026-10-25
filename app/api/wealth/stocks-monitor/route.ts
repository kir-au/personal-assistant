import { NextResponse } from 'next/server';

const DEFAULT_MONITOR_URL = 'http://127.0.0.1:3320';
const configuredMonitorUrl = process.env.STOCKS_MONITOR_URL || DEFAULT_MONITOR_URL;

type ShortlistCandidate = {
  symbol: string;
  companyName: string;
  exchange: string;
  country: string;
  exDate: string;
  daysUntilExDate: number;
  dividendAmount?: number;
  dividendCurrency?: string;
  paymentDate?: string;
  yield?: { value: number; basis: 'forward' | 'source-unspecified' };
  confidence: 'VERIFIED' | 'PROVISIONAL' | 'CONFLICTING' | 'STALE' | 'UNVERIFIED' | 'FIXTURE';
  sourceName: string;
  sourceUrl?: string;
  sourceRetrievedAt: string;
  researchPriority: 'higher' | 'standard' | 'needs-confirmation';
  reviewSummary: string;
  unresolvedItems: string[];
  marketUrl: string;
};

type MonitorShortlist = {
  mode?: 'live' | 'fixture';
  retrievedAt?: string;
  generatedAt?: string;
  timeZone?: string;
  policy?: {
    earliestExDateDays: number;
    latestExDateDays: number;
    maximumCandidates: number;
    watchedMarkets: string[];
    preferredQuoteCurrencies?: string[];
  };
  candidates?: ShortlistCandidate[];
};

function monitorRoot() {
  try {
    const url = new URL(configuredMonitorUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported monitor URL protocol');
    return url.origin;
  } catch {
    return DEFAULT_MONITOR_URL;
  }
}

export async function GET() {
  const root = monitorRoot();
  try {
    const response = await fetch(new URL('/api/shortlist', `${root}/`), {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Stocks monitor endpoint returned ${response.status}`);

    const shortlist = await response.json() as MonitorShortlist;
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      monitorUrl: root,
      monitorError: null,
      shortlist: {
        mode: shortlist.mode || 'fixture',
        retrievedAt: shortlist.retrievedAt || null,
        generatedAt: shortlist.generatedAt || null,
        timeZone: shortlist.timeZone || 'Australia/Sydney',
        policy: shortlist.policy || null,
        candidates: Array.isArray(shortlist.candidates) ? shortlist.candidates : [],
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      monitorUrl: root,
      monitorError: 'Stocks Monitor tunnel is unavailable. The daily research shortlist cannot be shown until the separate service is reachable.',
      shortlist: null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
