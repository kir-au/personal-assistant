'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';

type ShortlistCandidate = {
  symbol: string;
  companyName: string;
  exchange: string;
  country: string;
  quoteCurrency?: string;
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
  priorityReason?: string;
  reviewSummary: string;
  unresolvedItems: string[];
  marketUrl: string;
};

type StocksMonitorData = {
  generatedAt: string;
  monitorUrl: string;
  monitorError: string | null;
  shortlist: {
    mode: 'live' | 'fixture';
    retrievedAt: string | null;
    generatedAt: string | null;
    timeZone: string;
    policy: { earliestExDateDays: number; latestExDateDays: number; maximumCandidates: number; watchedMarkets: string[]; preferredQuoteCurrencies?: string[] } | null;
    candidates: ShortlistCandidate[];
  } | null;
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? '—' : new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(time);
}

function dividendAmount(value?: number, currency?: string) {
  if (value === undefined || !currency) return 'Amount unavailable';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency, maximumFractionDigits: 3 }).format(value);
}

function confidenceTone(value: ShortlistCandidate['confidence']) {
  if (value === 'VERIFIED') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (value === 'CONFLICTING' || value === 'STALE') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-amber-200 bg-amber-50 text-amber-900';
}

function priorityTone(value: ShortlistCandidate['researchPriority']) {
  if (value === 'higher') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (value === 'needs-confirmation') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-primary/25 bg-active text-primary';
}

export default function StocksMonitorPanel() {
  const [data, setData] = useState<StocksMonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/wealth/stocks-monitor', { cache: 'no-store' });
      const next = await response.json() as StocksMonitorData;
      if (!response.ok) throw new Error('Unable to load the daily research shortlist.');
      setData(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the daily research shortlist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const shortlist = data?.shortlist;
  const monitorUrl = data?.monitorUrl || 'http://127.0.0.1:3320';
  const policy = shortlist?.policy;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="grid gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary"><CalendarDays className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-wide">Daily stocks research</span></div>
          <h2 className="mt-2 text-xl font-semibold text-on-surface">Shortlist for manual review</h2>
          <p className="mt-1 w-full max-w-none text-sm text-on-surface-variant">Up to {policy?.maximumCandidates ?? 10} sourced candidates with ex-distribution dates from T+{policy?.earliestExDateDays ?? 2} to T+{policy?.latestExDateDays ?? 9}. This leaves a two-day review buffer plus one week ahead of the ex-date. NOK-traded candidates are shown first when they meet the same evidence and timing screen. Research only — not a buy list or trading instruction.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-on-surface-variant hover:bg-hover"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
          <a href={monitorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-dark">Open Stocks Monitor <ExternalLink className="h-3.5 w-3.5" /></a>
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-on-surface-variant">Loading daily shortlist…</p>}
      {error && <p className="mt-4 text-sm text-error">{error}</p>}
      {data?.monitorError && <p className="mt-4 flex gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{data.monitorError}</p>}

      {shortlist && <>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
          <span className={`rounded border px-2 py-1 font-semibold uppercase tracking-wide ${shortlist.mode === 'live' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{shortlist.mode === 'live' ? 'Live research data' : 'Fixture data'}</span>
          <span>Screened for {policy?.watchedMarkets.join(', ') ?? 'selected markets'} · refreshed {formatTime(shortlist.retrievedAt)}</span>
        </div>

        <div className="mt-4 grid gap-3">
          {shortlist.candidates.map((candidate) => <article key={`${candidate.exchange}:${candidate.symbol}`} className="rounded-lg border border-border bg-surface-variant p-4">
            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(220px,1fr)_150px_160px] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2"><a href={candidate.marketUrl} target="_blank" rel="noreferrer" className="text-lg font-semibold text-primary hover:underline">{candidate.symbol} <ExternalLink className="inline h-3.5 w-3.5" /></a><span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityTone(candidate.researchPriority)}`}>{candidate.researchPriority.replace('-', ' ')}</span><span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${confidenceTone(candidate.confidence)}`}>{candidate.confidence}</span></div>
                <p className="mt-1 text-sm font-medium text-on-surface">{candidate.companyName}</p><p className="mt-0.5 text-xs text-on-surface-variant">{candidate.exchange} · {candidate.country}{candidate.quoteCurrency ? ` · quote ${candidate.quoteCurrency}` : ''}{candidate.priorityReason ? ` · ${candidate.priorityReason}` : ''}</p>
              </div>
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Ex-distribution</p><p className="mt-1 text-sm font-semibold text-on-surface">{formatDate(candidate.exDate)} · T+{candidate.daysUntilExDate}</p><p className="mt-1 text-xs text-on-surface-variant">{dividendAmount(candidate.dividendAmount, candidate.dividendCurrency)} · paid {formatDate(candidate.paymentDate)}</p></div>
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Reported yield</p><p className="mt-1 text-sm font-semibold text-on-surface">{candidate.yield ? `${candidate.yield.value.toFixed(1)}%` : 'Unavailable'}</p><p className="mt-1 text-xs text-on-surface-variant">{candidate.yield?.basis === 'forward' ? 'Forward (source)' : candidate.yield ? 'Basis unspecified' : 'Not calculated'}</p></div>
            </div>
            <div className="mt-3 grid gap-3 border-t border-border pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.9fr)]">
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Why it appeared</p><p className="mt-1 text-sm leading-5 text-on-surface">{candidate.reviewSummary}</p><p className="mt-2 text-xs text-on-surface-variant">Evidence: {candidate.sourceUrl ? <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{candidate.sourceName} <ExternalLink className="inline h-3 w-3" /></a> : `${candidate.sourceName} — original URL not supplied`} · retrieved {formatTime(candidate.sourceRetrievedAt)}</p></div>
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Before manual review</p><ul className="mt-1 space-y-1 text-xs leading-5 text-on-surface-variant">{candidate.unresolvedItems.length ? candidate.unresolvedItems.map((item) => <li key={item}>• {item}</li>) : <li>• No outstanding item reported by the current source set.</li>}</ul></div>
            </div>
          </article>)}
          {!shortlist.candidates.length && <div className="rounded border border-border bg-surface-variant px-4 py-5 text-sm text-on-surface-variant">No sourced candidate currently meets the selected markets and T+2 to T+9 timing screen. Missing dates and unconfirmed events are not inferred.</div>}
        </div>
      </>}

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-active p-3 text-xs text-primary"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Vault boundary.</strong> This is a live, read-only shortlist through the local tunnel. The monitor retains source snapshots and normalised records; Personal Vault does not store broker access, execution controls or a copied market-data database.</p></div>
    </section>
  );
}
