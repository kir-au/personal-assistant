'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, CircleDot, RefreshCw, ShieldCheck } from 'lucide-react';

interface Trade {
  id: string;
  instrument: string;
  units: string;
  price: string;
  unrealizedPL?: string;
  financing?: string;
  takeProfitOrder?: { price?: string } | null;
}

interface Order {
  id: string;
  type: string;
  instrument?: string;
  units?: string;
  price?: string | null;
}

interface LiveState {
  ready?: boolean;
  updatedAt?: string;
  openTrades?: Trade[];
  pendingOrders?: Order[];
  automation?: {
    enabled?: boolean;
    phase?: string;
    targetPrice?: number | null;
    reason?: string | null;
  };
  automationV2?: {
    enabled?: boolean;
    phase?: string;
    armedAt?: string | null;
    retraceTouchedAt?: string | null;
    entryTradeId?: string | null;
    reason?: string | null;
  };
}

interface Strategy {
  provider: string;
  instrument: string;
  accountScope: string;
  timeframe: string;
  financingNote: string;
  strategy: {
    manualTriggerOrderId: string;
    manualTriggerUnits: number;
    entry: { units: number; positionFill: string; oneEntryOnly: boolean };
    pairedTakeProfit: { price: number; tradeIds: string[] };
    temporaryMaxNetShortUnits: number;
  };
  softCycleV2?: {
    entry?: { units?: number; positionFill?: string; oneEntryOnly?: boolean };
    temporaryMaxNetShortUnits?: number;
  };
}

interface ActivityEvent {
  id: string;
  type: string;
  occurredAt: string;
  data?: Record<string, any>;
}

interface OandaData {
  strategy: Strategy;
  activity: ActivityEvent[];
  live: LiveState | null;
  liveError: string | null;
}

function formatNumber(value?: string | number | null, decimals = 1) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-AU', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(number)
    : '—';
}

function formatTime(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? '—'
    : new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function describeEvent(event: ActivityEvent) {
  const trade = event.data?.trade || event.data?.after || event.data?.before;
  const order = event.data?.order || event.data?.after || event.data?.before;
  switch (event.type) {
    case 'baseline-snapshot': return 'Initial OANDA state recorded.';
    case 'daily-snapshot': return 'Daily OANDA state recorded.';
    case 'trade-opened': return `Opened ${trade?.id || 'trade'} · ${trade?.units || '—'} @ ${trade?.entryPrice || '—'}.`;
    case 'trade-closed': return `Closed ${trade?.id || 'trade'} · ${trade?.units || '—'} @ ${trade?.entryPrice || '—'}.`;
    case 'trade-changed': return `Protection changed on trade ${trade?.id || '—'}.`;
    case 'order-created': return `Created ${order?.type || 'order'} ${order?.id || '—'} at ${order?.price || 'market'}.`;
    case 'order-removed': return `Removed or filled order ${order?.id || '—'}.`;
    case 'order-changed': return `Changed order ${order?.id || '—'}.`;
    case 'automation-changed': return `Cycle ${event.data?.before?.phase || '—'} → ${event.data?.after?.phase || '—'}.`;
    case 'automation-v2-changed': return `Automatic v2 ${event.data?.before?.phase || '—'} → ${event.data?.after?.phase || '—'}.`;
    default: return event.type;
  }
}

function v2PhaseText(phase?: string) {
  if (phase === 'waiting-peak') return 'Armed — observing a fresh M15 peak';
  if (phase === 'waiting-retrace') return 'Peak confirmed — waiting for retrace and rejection';
  if (phase === 'cycle-active') return 'One -0.1 v2 entry is active; entry locked';
  if (phase === 'locked') return 'v2 completed; manual review required';
  if (phase === 'halted') return 'v2 halted — check the recorded reason';
  return phase ? phase.replaceAll('-', ' ') : 'Disabled';
}

function phaseText(phase?: string) {
  if (phase === 'waiting-trigger') return 'Waiting for existing 9199 sell MIT';
  if (phase === 'waiting-pullback') return 'Waiting for a closed bearish M15 pullback';
  if (phase === 'cycle-active') return 'One -0.2 cycle is active; entry locked';
  if (phase === 'locked') return 'Cycle completed; manual review required';
  if (phase === 'halted') return 'Halted — check the recorded reason';
  return phase ? phase.replaceAll('-', ' ') : 'Connecting';
}

export default function OandaTradingPanel() {
  const [data, setData] = useState<OandaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/trading/oanda', { cache: 'no-store' });
      const next = await response.json();
      if (!response.ok || next.error) throw new Error(next.error || 'Unable to load OANDA data.');
      setData(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load OANDA data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const live = data?.live;
  const strategy = data?.strategy;
  const shorts = useMemo(() => (live?.openTrades || []).filter((trade) => Number(trade.units) < 0), [live]);
  const netShort = useMemo(() => shorts.reduce((total, trade) => total + Math.abs(Number(trade.units) || 0), 0), [shorts]);
  const phase = live?.automation?.phase;
  const v2 = live?.automationV2;
  const targetPrice = live?.automation?.targetPrice ?? strategy?.strategy.pairedTakeProfit.price;
  const activeCeiling = strategy?.softCycleV2?.temporaryMaxNetShortUnits
    ?? strategy?.strategy.temporaryMaxNetShortUnits;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <ArrowDownRight className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wide">Live OANDA</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-on-surface">AU200 short cycles</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Read-only account view and Vault activity history. This dashboard cannot submit, change, or close OANDA orders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-medium ${live?.ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            <CircleDot className="h-3.5 w-3.5" /> {live?.ready ? 'Live connected' : 'Vault history'}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-on-surface-variant hover:bg-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-on-surface-variant">Loading OANDA state…</p>}
      {error && <p className="mt-4 text-sm text-error">{error}</p>}
      {data?.liveError && <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{data.liveError}</p>}

      {strategy && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-primary/20 bg-active p-3">
              <p className="text-xs font-semibold uppercase text-primary">Cycle state</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">{phaseText(phase)}</p>
              <p className="mt-1 text-xs text-on-surface-variant">Updated {formatTime(live?.updatedAt)}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-variant p-3">
              <p className="text-xs font-semibold uppercase text-on-surface-variant">Short exposure</p>
              <p className="mt-2 text-xl font-semibold text-on-surface">{formatNumber(netShort)} / {formatNumber(activeCeiling)}</p>
              <p className="mt-1 text-xs text-on-surface-variant">Active v2 AU200 ceiling</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-variant p-3">
              <p className="text-xs font-semibold uppercase text-on-surface-variant">Paired target</p>
              <p className="mt-2 text-xl font-semibold text-on-surface">{formatNumber(targetPrice)}</p>
              <p className="mt-1 text-xs text-on-surface-variant">Trades {strategy.strategy.pairedTakeProfit.tradeIds.join(' + ')}</p>
            </div>
            <div className={`rounded-lg border p-3 ${v2?.enabled ? 'border-violet-200 bg-violet-50' : 'border-border bg-surface-variant'}`}>
              <p className={`text-xs font-semibold uppercase ${v2?.enabled ? 'text-violet-800' : 'text-on-surface-variant'}`}>Automatic v2</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">{v2PhaseText(v2?.phase)}</p>
              <p className="mt-1 text-xs text-on-surface-variant">One -0.1 only · fresh M15 peak/retrace/rejection</p>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-surface-variant p-3 text-sm text-on-surface-variant">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>v1 history: one <strong className="text-on-surface">-0.2 OPEN_ONLY</strong> entry followed existing order {strategy.strategy.manualTriggerOrderId} and a fully closed M15 bearish pullback. {strategy.financingNote}</p>
          </div>
          {v2?.enabled && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
              <p>v2 leaves trade <strong>7892</strong> untouched, requires the existing 9000 targets on <strong>7875 + 7885</strong>, and can add only one <strong>-0.1</strong> while total AU200 short exposure stays at or below {formatNumber(activeCeiling)}. Armed {formatTime(v2.armedAt ?? undefined)}.</p>
            </div>
          )}
        </>
      )}

      {live && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_0.9fr]">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between bg-surface-variant px-3 py-2">
              <h3 className="text-sm font-semibold text-on-surface">Open short trades</h3>
              <span className="text-xs text-on-surface-variant">{shorts.length} position{shorts.length === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-border text-xs text-on-surface-variant"><tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Units</th><th className="px-3 py-2">Entry</th><th className="px-3 py-2">P/L</th><th className="px-3 py-2">Financing</th><th className="px-3 py-2">TP</th></tr></thead>
                <tbody>
                  {shorts.map((trade) => <tr key={trade.id} className="border-b border-border last:border-0"><td className="px-3 py-2 font-mono text-on-surface">{trade.id}</td><td className="px-3 py-2">{trade.units}</td><td className="px-3 py-2">{trade.price}</td><td className="px-3 py-2">{trade.unrealizedPL ?? '—'}</td><td className="px-3 py-2">{trade.financing ?? '—'}</td><td className="px-3 py-2">{trade.takeProfitOrder?.price ?? '—'}</td></tr>)}
                  {!shorts.length && <tr><td colSpan={6} className="px-3 py-5 text-on-surface-variant">No open AU200 shorts.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface-variant p-3">
            <h3 className="text-sm font-semibold text-on-surface">Pending orders</h3>
            <div className="mt-3 space-y-2">
              {(live.pendingOrders || []).map((order) => <div key={order.id} className="rounded border border-border bg-surface px-3 py-2 text-sm"><p className="font-mono text-on-surface">{order.id} · {order.type}</p><p className="mt-1 text-on-surface-variant">{order.units || '—'} {order.instrument || '—'} @ {order.price || 'market'}</p></div>)}
              {!live.pendingOrders?.length && <p className="text-sm text-on-surface-variant">No pending orders.</p>}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border bg-surface-variant p-3">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-on-surface">Daily Vault activity</h3><span className="text-xs text-on-surface-variant">append-only source journal</span></div>
        <div className="mt-3 space-y-2">
          {(data?.activity || []).slice(0, 8).map((event) => <div key={event.id} className="flex gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0"><span className="w-28 shrink-0 text-xs text-on-surface-variant">{formatTime(event.occurredAt)}</span><p className="text-on-surface"><span className="mr-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-on-surface-variant">{event.type}</span> {describeEvent(event)}</p></div>)}
          {!data?.activity?.length && <p className="text-sm text-on-surface-variant">The first local daily import will appear here after the engine journal is read.</p>}
        </div>
      </div>

      {live?.automation?.reason && <div className="mt-3 flex gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" />{live.automation.reason}</div>}
      {v2?.reason && <div className="mt-3 flex gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" />{v2.reason}</div>}
    </section>
  );
}
