'use client';

import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  Dumbbell,
  Folder,
  HeartPulse,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';

export interface AssistantTask {
  id: string;
  title: string;
  area: 'Product' | 'Personal Vault' | 'Health' | 'Family' | 'Admin' | 'AI' | 'Business' | 'Wealth' | 'Routine' | 'Work' | 'Travel' | 'Trading' | 'Car' | 'Politics' | 'Startup';
  status: 'suggested' | 'planned' | 'done' | 'review';
  source: string;
  date?: string;
  horizon?: string;
  projectId?: string;
  priority?: number;
  detail?: string;
}

export interface AssistantReviewCard {
  projectId: string;
  projectTitle: string;
  status: 'active' | 'needs-review' | 'watch' | 'reference';
  priority: number;
  title: string;
  reason: string;
  suggestedAction: string;
  evidencePath?: string;
  evidenceLabel?: string;
  questions?: string[];
  recentCaptures: number;
  linkedSources: number;
}

export interface AssistantReview {
  updatedAt: string;
  windowDays: number;
  source: string;
  cards: AssistantReviewCard[];
}

const areaIcon: Record<AssistantTask['area'], ReactNode> = {
  Product: <Target className="h-4 w-4 text-emerald-400" />,
  'Personal Vault': <Folder className="h-4 w-4 text-cyan-600" />,
  Health: <Dumbbell className="h-4 w-4 text-amber-400" />,
  Family: <Users className="h-4 w-4 text-rose-400" />,
  Admin: <Folder className="h-4 w-4 text-slate-400" />,
  AI: <Sparkles className="h-4 w-4 text-blue-500" />,
  Business: <BriefcaseBusiness className="h-4 w-4 text-emerald-500" />,
  Wealth: <TrendingUp className="h-4 w-4 text-violet-500" />,
  Routine: <Activity className="h-4 w-4 text-cyan-500" />,
  Work: <BriefcaseBusiness className="h-4 w-4 text-slate-500" />,
  Travel: <Folder className="h-4 w-4 text-sky-500" />,
  Trading: <TrendingUp className="h-4 w-4 text-indigo-500" />,
  Car: <Folder className="h-4 w-4 text-slate-500" />,
  Politics: <Folder className="h-4 w-4 text-slate-500" />,
  Startup: <Sparkles className="h-4 w-4 text-blue-500" />,
};

const reviewStatusLabel: Record<AssistantReviewCard['status'], string> = {
  active: 'active',
  'needs-review': 'review',
  watch: 'watch',
  reference: 'reference',
};

const actionStatusClass: Record<AssistantTask['status'], string> = {
  done: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  planned: 'border-blue-200 bg-blue-100 text-blue-800',
  suggested: 'border-amber-200 bg-amber-100 text-amber-800',
  review: 'border-violet-200 bg-violet-100 text-violet-800',
};

function iconForProject(projectId: string) {
  if (projectId === 'health') return <HeartPulse className="h-4 w-4" />;
  if (projectId === 'business') return <BriefcaseBusiness className="h-4 w-4" />;
  if (projectId === 'ai') return <Sparkles className="h-4 w-4" />;
  if (projectId === 'family') return <Users className="h-4 w-4" />;
  if (projectId === 'wealth') return <TrendingUp className="h-4 w-4" />;
  if (projectId === 'routine') return <Activity className="h-4 w-4" />;
  return <Folder className="h-4 w-4" />;
}

function projectHref(projectId?: string) {
  if (!projectId) return undefined;
  if (projectId === 'health') return '/?view=health';
  return `/?view=project&project=${encodeURIComponent(projectId)}`;
}

interface AssistantActionsPanelProps {
  assistantReview: AssistantReview | null;
  reviewTasks: AssistantTask[];
  compact?: boolean;
}

export default function AssistantActionsPanel({ assistantReview, reviewTasks, compact = false }: AssistantActionsPanelProps) {
  return (
    <section className={`rounded-lg border border-border bg-surface p-4 shadow-sm ${compact ? '' : 'xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto'}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Assistant actions</span>
          </div>
          <h3 className="text-base font-semibold text-on-surface">Proposed next moves</h3>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            Suggested from vault scan. Nothing is applied automatically.
          </p>
        </div>
        <span className="shrink-0 rounded border border-border bg-surface-variant px-2 py-1 text-xs text-on-surface-variant">
          {assistantReview?.windowDays ?? 30}d
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {(assistantReview?.cards ?? []).map((card) => (
          <article key={`${card.projectId}-${card.title}`} className="rounded-lg border border-border bg-surface-variant p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-primary">{iconForProject(card.projectId)}</span>
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-on-surface">{card.projectTitle}</h4>
                  <p className="text-xs text-on-surface-variant">
                    {card.recentCaptures} capture(s) / {card.linkedSources} source(s)
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded border border-border bg-surface px-2 py-0.5 text-xs text-on-surface-variant">
                {reviewStatusLabel[card.status]}
              </span>
            </div>
            <p className="text-sm font-semibold leading-snug text-on-surface">{card.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{card.reason}</p>
            {card.questions?.length ? (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-xs font-semibold text-amber-900">Need from you</p>
                <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-amber-900">
                  {card.questions.map((question) => (
                    <li key={question}>- {question}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-amber-800">Answer through the capture box; the source record stays unchanged.</p>
              </div>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">
              <span className="font-semibold text-on-surface">Proposed next step:</span> {card.suggestedAction}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={projectHref(card.projectId) ?? '/?view=today'}
                className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs font-medium text-primary hover:bg-active"
              >
                Open project
                <ArrowRight className="h-3 w-3" />
              </a>
              {card.evidencePath ? (
                <a
                  href={`/?view=vault&path=${encodeURIComponent(card.evidencePath)}`}
                  className="inline-flex max-w-full items-center gap-1 text-xs font-medium text-on-surface-variant hover:text-primary hover:underline"
                >
                  <span className="truncate">{card.evidenceLabel || 'Evidence'}</span>
                </a>
              ) : null}
            </div>
          </article>
        ))}

        {reviewTasks.map((task) => {
          const href = projectHref(task.projectId);
          return (
            <article key={task.id} className="rounded-lg border border-border bg-surface-variant p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-on-surface-variant">
                  {areaIcon[task.area]}
                  <span className="truncate">{task.area}</span>
                </div>
                <span className={`shrink-0 rounded border px-2 py-0.5 text-xs font-medium ${actionStatusClass[task.status]}`}>
                  {task.status}
                </span>
              </div>
              {href ? (
                <a href={href} className="text-sm font-semibold leading-snug text-on-surface hover:text-primary hover:underline">
                  {task.title}
                </a>
              ) : (
                <p className="text-sm font-semibold leading-snug text-on-surface">{task.title}</p>
              )}
              {task.detail ? <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">{task.detail}</p> : null}
            </article>
          );
        })}

        {reviewTasks.length === 0 && (assistantReview?.cards ?? []).length === 0 ? (
          <p className="rounded-lg border border-border bg-surface-variant p-3 text-sm text-on-surface-variant">
            No assistant actions are waiting.
          </p>
        ) : null}
      </div>
    </section>
  );
}
