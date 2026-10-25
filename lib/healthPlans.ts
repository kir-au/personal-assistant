import fsp from 'fs/promises';
import path from 'path';
import { readLatestHealthScheduleEvents, scheduleKey } from '@/lib/healthSchedule';
import { completionKey, readLatestHealthCompletionEvents } from '@/lib/healthCompletion';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const HEALTH_ROOT = path.join(VAULT_ROOT, 'structured', 'health');

export interface HealthPlanDay {
  day: number;
  date: string;
  label: string;
  kind: string;
  title: string;
  plan: string;
  completed?: boolean;
  completionStatus?: 'partial' | 'completed';
  actual?: {
    summary?: string;
    completed?: Array<{
      code: string;
      name: string;
      load: string | null;
      sets: number | null;
      reps: number | null;
    }>;
    remaining?: string[];
    rawPath?: string;
    painResponse?: {
      during: string | null;
      night: string | null;
      nextDay: string | null;
    };
  };
  planId?: string;
  projectId?: string;
  planTitle?: string;
  planStatus?: string;
  sourcePath?: string;
  sourceDay?: number;
  sessionId?: string;
  scheduledFromDate?: string;
  scheduleUpdatedAt?: string;
  carriedFromDate?: string;
  completedDate?: string;
}

export interface HealthPlanSummary {
  id: string;
  projectId: string;
  title: string;
  status: string;
  startDate: string | null;
  goal: string;
  rule: string;
  sourcePath: string;
  today: HealthPlanDay | null;
  upcoming: HealthPlanDay | null;
  days: HealthPlanDay[];
  notes: string[];
  exerciseKey: Array<{ code: string; label: string }>;
  carryForwardFrom?: string;
}

function getSydneyDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatDateLabel(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function addDays(dateValue: string, offset: number) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function normalizePlanRules(plan: any) {
  if (Array.isArray(plan.rules)) return plan.rules;
  if (typeof plan.rule === 'string') return [plan.rule];
  return [];
}

function normalizePlanNotes(plan: any) {
  if (Array.isArray(plan.notes)) return plan.notes;
  return normalizePlanRules(plan);
}

function normalizeDailyPlan(plan: any, sourcePath: string): HealthPlanSummary {
  const sourceDays = Array.isArray(plan.days) ? plan.days : [];
  const days: HealthPlanDay[] = sourceDays.map((day: any) => ({
    ...day,
    kind: day.kind || 'plan',
    planId: plan.id,
    projectId: plan.projectId,
    planTitle: plan.title,
    planStatus: plan.status || 'active',
    sourcePath,
    sourceDay: day.day,
  }));

  return {
    id: plan.id || path.basename(sourcePath, '.json'),
    projectId: plan.projectId || plan.id || 'health',
    title: plan.title || 'Health plan',
    status: plan.status || 'active',
    startDate: plan.startDate || days[0]?.date || null,
    goal: plan.goal || '',
    rule: plan.rule || normalizePlanRules(plan).join(' '),
    sourcePath,
    today: null,
    upcoming: null,
    days,
    notes: normalizePlanNotes(plan),
    exerciseKey: Array.isArray(plan.exerciseKey) ? plan.exerciseKey : [],
  };
}

function normalizeWeeklyRunningPlan(plan: any, sourcePath: string): HealthPlanSummary {
  const days: HealthPlanDay[] = [];
  const weeks = Array.isArray(plan.weeks) ? plan.weeks : [];

  for (const week of weeks) {
    if (!week.starts) continue;
    days.push({
      day: days.length + 1,
      date: week.starts,
      label: formatDateLabel(week.starts),
      kind: 'run-quality',
      title: `Week ${week.week}: Quality run`,
      plan: week.qualitySession,
      completed: false,
      planId: plan.id,
      projectId: plan.projectId,
      planTitle: plan.title,
      planStatus: plan.status || 'planned',
      sourcePath,
      sourceDay: week.week,
    });

    const sunday = addDays(week.starts, 4);
    days.push({
      day: days.length + 1,
      date: sunday,
      label: formatDateLabel(sunday),
      kind: 'run-long',
      title: `Week ${week.week}: Long run`,
      plan: week.sundayLongRun,
      completed: false,
      planId: plan.id,
      projectId: plan.projectId,
      planTitle: plan.title,
      planStatus: plan.status || 'planned',
      sourcePath,
      sourceDay: week.week,
    });
  }

  return {
    id: plan.id || path.basename(sourcePath, '.json'),
    projectId: plan.projectId || plan.id || 'health',
    title: plan.title || 'Running plan',
    status: plan.status || 'planned',
    startDate: plan.startDate || days[0]?.date || null,
    goal: plan.goal || '',
    rule: normalizePlanRules(plan)[0] || '',
    sourcePath,
    today: null,
    upcoming: null,
    days,
    notes: normalizePlanNotes(plan),
    exerciseKey: [],
  };
}

function normalizeRecurringPlan(plan: any, sourcePath: string): HealthPlanSummary {
  const schedule = plan.schedule || {};
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];
  const progression = Array.isArray(plan.progression) ? plan.progression : [];
  const startDate = plan.startDate;
  const endDate = schedule.endDate;
  const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays.map(Number) : [];
  const days: HealthPlanDay[] = [];

  if (startDate && endDate && weekdays.length > 0) {
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (!weekdays.includes(weekday)) continue;
      const session = sessions.find((candidate: any) => Number(candidate.weekday) === weekday);
      if (!session) continue;

      const phase = progression
        .filter((candidate: any) => !candidate.starts || candidate.starts <= date)
        .at(-1) || {};
      const rounds = Number(session.rounds || schedule.rounds || 4);
      const durationMin = Number(session.durationMin || schedule.durationMin || 20);
      const exercises = Array.isArray(session.exercises) ? session.exercises : [];
      const exercisePlan = exercises.map((exercise: any) => {
        const baseReps = Number(exercise.baseReps || exercise.reps || 0);
        const reps = exercise.progression === 'press'
          ? Number(phase.pressReps || baseReps)
          : Math.max(1, Math.round(baseReps * Number(phase.repMultiplier || 1)));
        const side = exercise.perSide
          ? '/side'
          : exercise.alternateSides
            ? ' (alternate sides)'
            : '';
        const load = exercise.load ? ` (${exercise.load})` : '';
        return `${exercise.code || exercise.name} ${reps}${side}${load}`;
      }).join(' · ');

      days.push({
        day: days.length + 1,
        date,
        label: formatDateLabel(date),
        kind: session.kind || 'kettlebell',
        // Session IDs and progression labels remain in the plan source; the daily UI shows only executable work.
        title: '',
        plan: `${durationMin}-minute EMOM · ${rounds} rounds · ${exercisePlan}`,
        completed: false,
        planId: plan.id,
        projectId: plan.projectId,
        planTitle: plan.title,
        planStatus: plan.status || 'active',
        sourcePath,
        sourceDay: days.length + 1,
        sessionId: session.id,
      });
    }
  }

  return {
    id: plan.id || path.basename(sourcePath, '.json'),
    projectId: plan.projectId || plan.id || 'health',
    title: plan.title || 'Recurring health plan',
    status: plan.status || 'active',
    startDate: plan.startDate || days[0]?.date || null,
    goal: plan.goal || '',
    rule: plan.rule || normalizePlanRules(plan).join(' '),
    sourcePath,
    today: null,
    upcoming: null,
    days,
    notes: normalizePlanNotes(plan),
    exerciseKey: Array.isArray(plan.exerciseKey) ? plan.exerciseKey : [],
    carryForwardFrom: typeof schedule.carryForward?.starts === 'string'
      ? schedule.carryForward.starts
      : undefined,
  };
}

function normalizePlan(plan: any, sourcePath: string): HealthPlanSummary {
  if (Array.isArray(plan.days)) return normalizeDailyPlan(plan, sourcePath);
  if (Array.isArray(plan.weeks)) return normalizeWeeklyRunningPlan(plan, sourcePath);
  if (plan.schedule?.type === 'weekly-recurring' && Array.isArray(plan.sessions)) {
    return normalizeRecurringPlan(plan, sourcePath);
  }
  return normalizeDailyPlan({ ...plan, days: [] }, sourcePath);
}

function collapseScheduleCollisions(days: HealthPlanDay[]) {
  const byDate = new Map<string, HealthPlanDay>();

  for (const day of days) {
    const current = byDate.get(day.date);
    if (!current) {
      byDate.set(day.date, day);
      continue;
    }

    // A deliberate move takes that day's single training slot over the regular recurrence.
    // The original move event remains the source record; this only prevents two commitments
    // from being rendered for one plan on the same date.
    const currentWasMoved = Boolean(current.scheduledFromDate);
    const candidateWasMoved = Boolean(day.scheduledFromDate);
    if (candidateWasMoved && !currentWasMoved) {
      byDate.set(day.date, day);
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function applyCarryForward(days: HealthPlanDay[], todayDate: string, starts: string | undefined) {
  if (!starts) return days;

  const historical = days.filter((day) => day.date < starts);
  const managed = days
    .filter((day) => day.date >= starts)
    // Preserve the plan's session sequence after a move. Sorting by the current
    // date would let a later recurring session jump ahead of an earlier one that
    // was deliberately deferred.
    .sort((left, right) => Number(left.sourceDay || 0) - Number(right.sourceDay || 0) || left.date.localeCompare(right.date));
  let occupiedThrough: string | null = null;

  const resolved = managed.map((day) => {
    const scheduledDate = day.date;
    const minimumDate = occupiedThrough ? addDays(occupiedThrough, 1) : scheduledDate;
    const dueDate = scheduledDate <= todayDate ? todayDate : scheduledDate;
    const effectiveDate = day.completedDate
      ? day.completedDate
      : dueDate > minimumDate
        ? dueDate
        : minimumDate;

    // A completion recorded out of sequence is historical evidence. It must not
    // pull the queue backward past an earlier unfinished session.
    occupiedThrough = !occupiedThrough || effectiveDate > occupiedThrough
      ? effectiveDate
      : occupiedThrough;
    return {
      ...day,
      date: effectiveDate,
      label: formatDateLabel(effectiveDate),
      carriedFromDate: !day.completedDate && effectiveDate !== scheduledDate ? scheduledDate : undefined,
    };
  });

  return [...historical, ...resolved];
}

async function listHealthPlanFiles() {
  const entries = await fsp.readdir(HEALTH_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-plan.json'))
    .map((entry) => path.join(HEALTH_ROOT, entry.name))
    .sort();
}

export async function readHealthPlans(options: { includeInactive?: boolean } = {}) {
  const includeInactive = options.includeInactive ?? false;
  const todayDate = getSydneyDate();
  const files = await listHealthPlanFiles();
  const [scheduleEvents, completionEvents] = await Promise.all([
    readLatestHealthScheduleEvents(),
    readLatestHealthCompletionEvents(),
  ]);
  const plans: HealthPlanSummary[] = [];

  for (const file of files) {
    const raw = await fsp.readFile(file, 'utf-8');
    const relativePath = path.relative(VAULT_ROOT, file);
    const plan = normalizePlan(JSON.parse(raw), relativePath);
    if (!includeInactive && ['paused', 'cancelled', 'archived', 'inactive'].includes(plan.status.toLowerCase())) continue;
    plan.days = plan.days.map((day) => {
      const event = day.sourceDay
        ? scheduleEvents.get(scheduleKey(plan.id, day.sourceDay))
        : null;
      const completion = day.sourceDay
        ? completionEvents.get(completionKey(plan.id, day.sourceDay))
        : null;
      // A restart creates a new schedule baseline. Preserve earlier move events as history,
      // but do not let them displace sessions in the restarted cycle.
      const scheduledDay = !event || (plan.startDate && event.fromDate < plan.startDate)
        ? day
        : {
        ...day,
        date: event.toDate,
        label: formatDateLabel(event.toDate),
        scheduledFromDate: event.fromDate,
        scheduleUpdatedAt: event.created,
      };
      if (!completion) return scheduledDay;
      return {
        ...scheduledDay,
        completed: true,
        completionStatus: 'completed',
        completedDate: completion.completedDate,
        actual: {
          ...scheduledDay.actual,
          summary: completion.source === 'capture-processor'
            ? 'Recorded complete from a Health capture.'
            : 'Marked complete in Health Dashboard.',
        },
      };
    });
    plan.days = applyCarryForward(plan.days, todayDate, plan.carryForwardFrom);
    plan.days = collapseScheduleCollisions(plan.days);
    plan.today = plan.days.find((day) => day.date === todayDate) || null;
    plan.upcoming = plan.days.find((day) => day.date >= todayDate && !day.completed) || null;
    plans.push(plan);
  }

  const combinedDays = plans
    .flatMap((plan) => plan.days)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.planTitle || '').localeCompare(b.planTitle || ''))
    .map((day, index) => ({ ...day, day: index + 1 }));
  const combinedPlans = plans.map((plan) => {
    const days = combinedDays.filter((day) => day.planId === plan.id);
    return {
      ...plan,
      days,
      today: days.find((day) => day.date === todayDate) || null,
      upcoming: days.find((day) => day.date >= todayDate && !day.completed) || null,
    };
  });

  return {
    todayDate,
    plans: combinedPlans,
    days: combinedDays,
    today: combinedDays.find((day) => day.date === todayDate) || null,
    upcoming: combinedDays.find((day) => day.date >= todayDate && !day.completed) || null,
  };
}
