'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, CalendarDays, Check, CheckCircle2, Circle, RefreshCw, Sparkles } from 'lucide-react';
import type { AssistantTask } from './AssistantActionsPanel';

type PlannerTask = AssistantTask;
type PlannerItemAction = 'done' | 'move-tomorrow' | 'deprioritize';

interface WeeklyDay {
  date: string;
  taskId: string;
  whyNow: string;
}

interface WeeklyDecision {
  id: string;
  projectId: string;
  title: string;
  question: string;
  reason: string;
  nextStep: string;
  evidencePath?: string;
}

interface WeeklyBrief {
  title: string;
  weekOf: string;
  status: 'proposed' | 'accepted';
  premise: string;
  constraints: string[];
  days: WeeklyDay[];
  decisions: WeeklyDecision[];
}

interface PlannerProjection {
  title: string;
  weekFocus: string;
  tasks: PlannerTask[];
  weeklyBrief?: WeeklyBrief | null;
}

const areaColor: Record<PlannerTask['area'], string> = {
  Product: 'border-l-emerald-500',
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

export default function PlannerView() {
  const [projection, setProjection] = useState<PlannerProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadPlanner = useCallback(async () => {
    const response = await fetch(`/api/planner?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Planner projection is unavailable.');
    setProjection(await response.json());
  }, []);

  useEffect(() => {
    loadPlanner()
      .catch(() => setProjection(null))
      .finally(() => setLoading(false));
  }, [loadPlanner]);

  const weeklyRows = useMemo(() => {
    if (!projection?.weeklyBrief) return [];
    const taskById = new Map(projection.tasks.map((task) => [task.id, task]));
    return projection.weeklyBrief.days
      .map((day) => ({ day, task: taskById.get(day.taskId) }))
      .sort((left, right) => (left.task?.date ?? left.day.date).localeCompare(right.task?.date ?? right.day.date));
  }, [projection]);

  async function refreshPlanner() {
    setRefreshing(true);
    try {
      await fetch('/api/planner/regenerate', { method: 'POST' });
      await loadPlanner();
    } finally {
      setRefreshing(false);
    }
  }

  async function updatePlannerItem(itemId: string, action: PlannerItemAction) {
    setPendingItemId(itemId);
    try {
      const response = await fetch('/api/planner/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, action }),
      });
      if (!response.ok) throw new Error('Unable to update the task.');
      await loadPlanner();
      window.dispatchEvent(new Event('planner-projection-changed'));
    } finally {
      setPendingItemId(null);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-on-surface-variant">Loading weekly plan...</div>;
  }

  if (!projection) {
    return <div className="rounded-lg border border-border bg-surface p-4 text-sm text-on-surface-variant">Weekly plan is not available.</div>;
  }

  const weeklyBrief = projection.weeklyBrief;

  return (
    <div className="flex w-full max-w-[1440px] flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border pb-4">
            <div className="w-full min-w-0">
              <div className="mb-1 flex items-center gap-2 text-primary">
                <CalendarDays className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">AI weekly plan</span>
              </div>
              <h2 className="text-xl font-semibold text-on-surface">{weeklyBrief?.title ?? 'Weekly plan'}</h2>
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

          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            {weeklyBrief?.premise ?? projection.weekFocus}
          </p>

          {weeklyBrief?.constraints?.length ? (
            <div className="mt-4 border-l-2 border-cyan-500 bg-cyan-500/5 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">Plan conditions</p>
              <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{weeklyBrief.constraints.join(' ')}</p>
            </div>
          ) : null}

          <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {weeklyRows.map(({ day, task }) => {
              const scheduledDate = task?.date ?? day.date;
              const pending = task && pendingItemId === task.id;
              return (
                <article key={day.taskId} className={`grid gap-3 border-l-4 bg-surface p-3 sm:grid-cols-[112px_minmax(0,1fr)_auto] ${task ? areaColor[task.area] : 'border-l-slate-300'}`}>
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{formatDate(scheduledDate)}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">Primary project block</p>
                  </div>
                  <div className="min-w-0">
                    {task ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                          {task.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4" />}
                          <span>{task.area}</span>
                          <span className="rounded border border-border bg-surface-variant px-1.5 py-0.5">{task.status}</span>
                        </div>
                        <a href={projectHref(task.projectId)} className="mt-1 block text-sm font-semibold leading-snug text-on-surface hover:text-primary hover:underline">
                          {task.title}
                        </a>
                        <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{day.whyNow}</p>
                        {task.detail ? <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{task.detail}</p> : null}
                      </>
                    ) : (
                      <p className="text-sm text-on-surface-variant">This item is no longer active. Keep the day open or promote a replacement from the project page.</p>
                    )}
                  </div>
                  {task ? (
                    <div className="flex items-start gap-1 sm:justify-end">
                      <a
                        href={projectHref(task.projectId)}
                        title={`Open ${task.area} project`}
                        aria-label={`Open ${task.area} project`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-primary hover:bg-active"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </a>
                      {task.status !== 'done' ? (
                        <>
                          <button type="button" title="Mark done" aria-label="Mark done" onClick={() => updatePlannerItem(task.id, 'done')} disabled={pending} className="inline-flex h-8 w-8 items-center justify-center rounded border border-emerald-200 bg-surface text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                            <Check className="h-4 w-4" />
                          </button>
                          <button type="button" title="Move to tomorrow" aria-label="Move to tomorrow" onClick={() => updatePlannerItem(task.id, 'move-tomorrow')} disabled={pending} className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-on-surface-variant hover:bg-active disabled:opacity-50">
                            <ArrowRight className="h-4 w-4" />
                          </button>
                          <button type="button" title="Move to later review" aria-label="Move to later review" onClick={() => updatePlannerItem(task.id, 'deprioritize')} disabled={pending} className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-on-surface-variant hover:bg-active disabled:opacity-50">
                            <Archive className="h-4 w-4" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {weeklyRows.length === 0 ? <p className="p-4 text-sm text-on-surface-variant">No weekly recommendation has been prepared yet.</p> : null}
          </div>
        </section>

        <aside className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="mb-4 flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Decisions shaping this week</p>
              <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">Only questions that can change the plan belong here.</p>
            </div>
          </div>
          <div className="space-y-3">
            {(weeklyBrief?.decisions ?? []).map((decision) => (
              <article key={decision.id} className="rounded-lg border border-border bg-surface-variant p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-on-surface-variant">{decision.projectId}</span>
                  <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">needs input</span>
                </div>
                <h3 className="mt-2 text-sm font-semibold leading-snug text-on-surface">{decision.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{decision.question}</p>
                <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{decision.reason}</p>
                <p className="mt-3 text-xs font-medium leading-relaxed text-primary">{decision.nextStep}</p>
                <a href={projectHref(decision.projectId)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Open project <ArrowRight className="h-3 w-3" />
                </a>
              </article>
            ))}
            {(weeklyBrief?.decisions ?? []).length === 0 ? <p className="text-sm text-on-surface-variant">No decisions are blocking this week.</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
