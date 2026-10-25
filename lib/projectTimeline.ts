export interface ProjectInsights {
  project: string;
  title: string;
  summary: string;
  currentFocus?: string;
  workstreams?: Array<{
    title: string;
    why: string;
    nextStep: string;
    sourceTitles?: string[];
  }>;
  suggestedActions?: Array<{
    title: string;
    horizon: string;
    description: string;
    target: string;
    sourceTitles?: string[];
  }>;
  backlog?: {
    title: string;
    goal: string;
    whyThisMatters: string;
    items: Array<{
      id: string;
      title: string;
      status: string;
      priority: number;
      horizon: string;
      targetDate?: string;
      why: string;
      notDoneBecause: string;
      desiredOutcome: string;
      sourcePaths?: string[];
    }>;
  };
}

export interface ProjectTimelineItem {
  id: string;
  priority: number;
  date?: string;
  dateLabel: string;
  status: string;
  title: string;
  plan: string;
  why?: string;
  notDoneBecause?: string;
  outcome?: string;
  sourcePaths?: string[];
  mutable?: boolean;
}

export interface ProjectPlanItem {
  id: string;
  title: string;
  status: string;
  priority: number;
  date?: string;
  horizon?: string;
  detail?: string;
  why?: string;
  outcome?: string;
  source?: string;
  planPath?: string;
}

function projectDateValue(date?: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return date;
}

function formatProjectDate(dateValue?: string) {
  const date = projectDateValue(dateValue);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(`${date}T00:00:00`));
}

// Reference sources and registry copy are deliberately not task inputs.
export function buildProjectTimelineItems(
  currentPlanItems: ProjectPlanItem[],
  insights: ProjectInsights | null,
  { planUnavailable = false }: { planUnavailable?: boolean } = {}
): ProjectTimelineItem[] {
  if (planUnavailable) return [];
  if (currentPlanItems.length) {
    return currentPlanItems.map((item) => ({
      id: item.id,
      priority: item.priority,
      date: projectDateValue(item.date),
      dateLabel: formatProjectDate(item.date) || item.horizon || 'current',
      status: item.status,
      title: item.title,
      plan: item.detail || item.title,
      why: item.why,
      outcome: item.outcome,
      sourcePaths: item.planPath ? [item.planPath] : [],
      mutable: true,
    }));
  }
  if (insights?.backlog?.items?.length) {
    return insights.backlog.items.slice().sort((a, b) => b.priority - a.priority).map((item) => ({
      id: item.id,
      priority: item.priority,
      date: projectDateValue(item.targetDate),
      dateLabel: formatProjectDate(item.targetDate) || item.horizon,
      status: item.status,
      title: item.title,
      plan: item.desiredOutcome,
      why: item.why,
      notDoneBecause: item.notDoneBecause,
      outcome: item.desiredOutcome,
      sourcePaths: item.sourcePaths,
    }));
  }
  if (insights?.suggestedActions?.length) {
    return insights.suggestedActions.map((action, index) => ({
      id: `action-${index}-${action.title}`,
      priority: 100 - index * 10,
      date: undefined,
      dateLabel: action.horizon,
      status: 'suggested',
      title: action.title,
      plan: action.description,
      outcome: action.target,
      sourcePaths: [],
    }));
  }
  if (insights?.workstreams?.length) {
    return insights.workstreams.map((workstream, index) => ({
      id: `workstream-${index}-${workstream.title}`,
      priority: 90 - index * 10,
      date: undefined,
      dateLabel: 'this-week',
      status: 'review',
      title: workstream.title,
      plan: workstream.nextStep,
      why: workstream.why,
      sourcePaths: [],
    }));
  }
  return [];
}
