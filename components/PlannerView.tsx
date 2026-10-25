'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, CalendarDays, Check, CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import type { AssistantTask } from './AssistantActionsPanel';
import { groupPlannerTasks } from '../lib/plannerSections';
import { NO_CURRENT_SUMMARY } from '../lib/plannerCurrentSummary.mjs';

type PlannerTask = AssistantTask & {
  carriedOverFrom?: string;
  mutable?: boolean;
  needsPlannerReview?: boolean;
};
type PlannerItemAction = 'done' | 'move-tomorrow' | 'deprioritize' | 'drop';

interface PlannerProjection {
  title: string;
  weekFocus: string;
  tasks: PlannerTask[];
  dates?: {
    today?: string;
    tomorrow?: string;
  };
  currentSummary?: {
    reviewedAt: string;
    summary: string;
    sourceLinks: Array<{ path: string; label?: string }>;
  } | null;
  // Legacy field is deliberately ignored. A dated Vault snapshot is historical
  // evidence, never a default Planner headline.
  currentState?: unknown;
  generatedAt?: string;
  freshness?: {
    state?: string;
    stale?: boolean;
    checkedAt?: string | null;
    reason?: string | null;
  };
}

const areaColor: Record<PlannerTask['area'], string> = {
  Product: 'border-l-emerald-500',
  'Personal Vault': 'border-l-cyan-600',
  Health: 'border-l-amber-500',
  Family: 'border-l-rose-500',
  Admin: 'border-l-slate-500',
  AI: 'border-l-blue-500',
  Business: 'border-l-emerald-500',
  Wealth: 'border-l-violet-500',
  Routine: 'border-l-cyan-500',
  Work: 'border-l-slate-500',
  Travel: 'border-l-sky-500',
  Trading: 'border-l-indigo-500',
  Car: 'border-l-slate-500',
  Politics: 'border-l-slate-500',
  Startup: 'border-l-blue-500',
};

function projectHref(projectId?: string) {
  if (!projectId) return '/?view=today';
  if (projectId === 'health') return '/?view=health';
  return `/?view=project&project=${encodeURIComponent(projectId)}`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T12:00:00+10:00`));
}

function byPriority(left: PlannerTask, right: PlannerTask) {
  return (right.priority || 0) - (left.priority || 0) || left.title.localeCompare(right.title);
}

export default function PlannerView() {
  const [projection, setProjection] = useState<PlannerProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlanner = useCallback(async () => {
    const response = await fetch(`/api/planner?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Planner projection is unavailable.');
    setProjection(await response.json());
    setError(null);
  }, []);

  useEffect(() => {
    loadPlanner()
      .catch(() => setProjection(null))
      .finally(() => setLoading(false));
  }, [loadPlanner]);

  useEffect(() => {
    const refresh = () => { void loadPlanner().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Planner status is unavailable.')); };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [loadPlanner]);

  const { todayTasks, tomorrowTasks, reviewTasks, futureTasks, waitingTasks, laterTasks } = useMemo(() => {
    const tasks = projection?.tasks || [];
    const today = projection?.dates?.today;
    const tomorrow = projection?.dates?.tomorrow;

    const groups = groupPlannerTasks(tasks, today, tomorrow);
    return {
      todayTasks: groups.today.sort(byPriority),
      tomorrowTasks: groups.tomorrow.sort(byPriority),
      reviewTasks: groups.review.sort(byPriority),
      futureTasks: groups.future.sort((a, b) => (a.date || '').localeCompare(b.date || '') || byPriority(a, b)),
      waitingTasks: groups.waiting.sort(byPriority),
      laterTasks: groups.later.sort(byPriority),
    };
  }, [projection]);

  async function refreshPlanner() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch('/api/planner/regenerate', { method: 'POST' });
      if (!response.ok) throw new Error('Unable to refresh the plan. The last loaded view is still shown.');
      await loadPlanner();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to refresh the plan.');
    } finally {
      setRefreshing(false);
    }
  }

  async function updatePlannerItem(itemId: string, action: PlannerItemAction) {
    setPendingItemId(itemId);
    setError(null);
    try {
      const response = await fetch('/api/planner/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, action }),
      });
      if (!response.ok) throw new Error('Unable to update the task.');
      await loadPlanner();
      window.dispatchEvent(new Event('planner-projection-changed'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to update the task.');
    } finally {
      setPendingItemId(null);
    }
  }

  function renderTask(task: PlannerTask) {
    const pending = pendingItemId === task.id;
    return (
      <article key={task.id} className={`grid gap-3 border-l-4 bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto] ${areaColor[task.area]}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
            {task.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4" />}
            <span>{task.area}</span>
            <span className="rounded border border-border bg-surface-variant px-1.5 py-0.5">{task.status}</span>
            {task.carriedOverFrom ? <span>Originally scheduled {formatDate(task.carriedOverFrom)}</span> : task.date ? <span>{formatDate(task.date)}</span> : null}
          </div>
          <a href={projectHref(task.projectId)} className="mt-1 block text-sm font-semibold leading-snug text-on-surface hover:text-primary hover:underline">
            {task.title}
          </a>
          {task.detail ? <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{task.detail}</p> : null}
        </div>
        <div className="flex items-start gap-1 sm:justify-end">
          <a
            href={projectHref(task.projectId)}
            title={`Open ${task.area} project`}
            aria-label={`Open ${task.area} project`}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-primary hover:bg-active"
          >
            <ArrowRight className="h-4 w-4" />
          </a>
          {task.mutable && task.status !== 'done' ? (
            <>
              <button type="button" title="Mark done" aria-label="Mark done" onClick={() => updatePlannerItem(task.id, 'done')} disabled={pending} className="inline-flex h-8 w-8 items-center justify-center rounded border border-emerald-200 bg-surface text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" title="Move to tomorrow" aria-label="Move to tomorrow" onClick={() => updatePlannerItem(task.id, 'move-tomorrow')} disabled={pending} className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-on-surface-variant hover:bg-active disabled:opacity-50">
                <ArrowRight className="h-4 w-4" />
              </button>
              <button type="button" title="Move to later review" aria-label="Move to later review" onClick={() => updatePlannerItem(task.id, 'deprioritize')} disabled={pending} className="inline-flex h-8 items-center justify-center rounded border border-border bg-surface px-2 text-xs text-on-surface-variant hover:bg-active disabled:opacity-50">
                Later
              </button>
              <button type="button" title="Archive from active plan" aria-label="Archive from active plan" onClick={() => updatePlannerItem(task.id, 'drop')} disabled={pending} className="inline-flex h-8 items-center gap-1 justify-center rounded border border-border bg-surface px-2 text-xs text-on-surface-variant hover:bg-active disabled:opacity-50">
                <Archive className="h-4 w-4" />
                Archive
              </button>
            </>
          ) : null}
        </div>
      </article>
    );
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-on-surface-variant">Loading daily plan...</div>;
  }

  if (!projection) {
    return <div className="rounded-lg border border-border bg-surface p-4 text-sm text-on-surface-variant">Daily plan is not available.</div>;
  }

  const todayLabel = projection.dates?.today ? formatDate(projection.dates.today) : 'Today';
  const tomorrowLabel = projection.dates?.tomorrow ? formatDate(projection.dates.tomorrow) : 'Tomorrow';
  const visibleReviewTasks = reviewTasks.slice(0, 5);
  const remainingReviewTasks = reviewTasks.slice(5);
  const currentSummary = projection.currentSummary && projection.currentSummary.sourceLinks?.length
    ? projection.currentSummary
    : null;

  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-4">
      {error ? <p role="alert" className="rounded border border-error p-3 text-sm text-error">{error}</p> : null}
      {projection.freshness?.stale ? (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Planner may be out of date{projection.freshness.reason ? `: ${projection.freshness.reason}` : '.'}
        </p>
      ) : projection.freshness?.state === 'fresh' ? (
        <p role="status" className="text-xs text-on-surface-variant">Sources verified · {projection.freshness.checkedAt ? new Date(projection.freshness.checkedAt).toLocaleString() : 'just now'}</p>
      ) : null}
      {currentSummary ? (
        <section className="border-y border-primary/20 bg-active px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">What changed since the last review · {currentSummary.reviewedAt.slice(0, 10)}</p>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{currentSummary.summary}</p>
              <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">Missing records are evidence gaps, not unfinished tasks.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {currentSummary.sourceLinks.map((source) => (
                <a key={source.path} href={`/?view=vault&file=${encodeURIComponent(source.path)}`} className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded border border-primary/30 bg-surface px-3 text-xs font-medium text-primary hover:bg-active">
                  {source.label || 'Open evidence'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="border-y border-primary/20 bg-active px-4 py-3">
          <p className="text-sm font-medium text-on-surface">{NO_CURRENT_SUMMARY}</p>
          <p className="mt-1 text-xs text-on-surface-variant">Missing records are evidence gaps, not unfinished tasks.</p>
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border pb-4">
          <div className="w-full min-w-0">
            <div className="mb-1 flex items-center gap-2 text-primary">
              <CalendarDays className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Daily planner</span>
            </div>
            <h2 className="text-xl font-semibold text-on-surface">Today · {todayLabel}</h2>
          </div>
          <button
            type="button"
            onClick={refreshPlanner}
            disabled={refreshing}
            title="Refresh the projection from current plan files"
            className="inline-flex h-9 items-center gap-2 rounded border border-border bg-surface px-3 text-sm text-on-surface-variant hover:bg-active disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">Show only explicit commitments and verified active plans. Missing evidence is not a task.</p>
        <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">Overdue items never become today's work automatically.</p>

        <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {todayTasks.map(renderTask)}
          {todayTasks.length === 0 ? <p className="p-4 text-sm text-on-surface-variant">No active commitment for today. Promote one task when you are ready.</p> : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Tomorrow</p>
          <h2 className="mt-1 text-lg font-semibold text-on-surface">{tomorrowLabel}</h2>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {tomorrowTasks.map(renderTask)}
          {tomorrowTasks.length === 0 ? <p className="p-4 text-sm text-on-surface-variant">Nothing is committed for tomorrow yet.</p> : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Needs review</p>
          <h2 className="mt-1 text-lg font-semibold text-on-surface">{reviewTasks.length} item{reviewTasks.length === 1 ? '' : 's'} to reconcile</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Check existing outcomes and changed priorities before rescheduling. An old date does not prove the work is unfinished.</p>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {visibleReviewTasks.map(renderTask)}
          {reviewTasks.length === 0 ? <p className="p-4 text-sm text-on-surface-variant">No items need reconciliation.</p> : null}
        </div>
        {remainingReviewTasks.length ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-primary">Show remaining {remainingReviewTasks.length} review item{remainingReviewTasks.length === 1 ? '' : 's'}</summary>
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {remainingReviewTasks.map(renderTask)}
            </div>
          </details>
        ) : null}
      </section>
      {[
        { title: 'Upcoming', tasks: futureTasks, empty: 'No future commitments recorded.' },
        { title: 'Waiting', tasks: waitingTasks, empty: 'No waiting items recorded.' },
        { title: 'Later / undated', tasks: laterTasks, empty: 'No deferred or undated items recorded.' },
      ].map((section) => (
        <section key={section.title} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-on-surface">{section.title}</h2>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {section.tasks.map(renderTask)}
            {!section.tasks.length ? <p className="p-4 text-sm text-on-surface-variant">{section.empty}</p> : null}
          </div>
        </section>
      ))}
    </div>
  );
}
