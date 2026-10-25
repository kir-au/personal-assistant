import fs from 'fs/promises';
import path from 'path';
import { syncProjectPlanIndex } from './sync-project-plan-index.mjs';
import { selectCurrentPlannerSummary } from '../lib/plannerCurrentSummary.mjs';
import { refreshSourceInventory } from '../lib/sourceInventoryWorker.mjs';

const VAULT_ROOT = path.resolve(process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault'));
const OUTPUT_PATH = path.join(VAULT_ROOT, 'structured', 'plans', 'daily-projection.json');
const PROJECTION_VERSION = 3;

function getSydneyDate(offset = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offset);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readJsonl(relativePath) {
  try {
    const raw = await fs.readFile(path.join(VAULT_ROOT, relativePath), 'utf-8');
    return raw.split('\n').map((line) => line.trim()).filter(Boolean).map(parseJsonLine).filter(Boolean);
  } catch {
    return [];
  }
}

async function readJson(relativePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(VAULT_ROOT, relativePath), 'utf-8'));
  } catch {
    return fallback;
  }
}

function daysAgo(dateValue) {
  const time = new Date(dateValue || 0).getTime();
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 86_400_000;
}

function byProject(entries) {
  const result = new Map();
  for (const entry of entries) {
    const project = entry.projectId || entry.project || 'inbox';
    const list = result.get(project) || [];
    list.push(entry);
    result.set(project, list);
  }
  return result;
}

function task({ id, title, area, status = 'suggested', source, date, horizon, priority, projectId, detail }) {
  return { id, title, area, status, source, date, horizon, priority, projectId, detail };
}

function dateMs(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function runningBlockForDate(healthPlan, date) {
  if (!healthPlan || ['paused', 'cancelled', 'archived', 'inactive'].includes(String(healthPlan.status || '').toLowerCase())) return null;
  const directDay = healthPlan?.days?.find?.((day) => day.date === date);
  if (directDay) {
    return {
      title: directDay.title || `Day ${directDay.day}`,
      plan: directDay.plan,
      detail: directDay.notes || healthPlan?.rules?.[0],
    };
  }

  const weeks = healthPlan?.weeks || [];
  const currentWeek = weeks
    .filter((week) => week.starts && dateMs(week.starts) <= dateMs(date))
    .sort((a, b) => dateMs(b.starts) - dateMs(a.starts))[0];
  if (!currentWeek) return null;

  if (date === currentWeek.starts) {
    return {
      title: `Week ${currentWeek.week}: Quality run`,
      plan: currentWeek.qualitySession,
      detail: currentWeek.notes || healthPlan?.rules?.[0],
    };
  }

  const longRunDate = addDays(currentWeek.starts, 4);
  if (date === longRunDate) {
    return {
      title: `Week ${currentWeek.week}: Long run`,
      plan: currentWeek.sundayLongRun,
      detail: currentWeek.notes || healthPlan?.rules?.[0],
    };
  }

  return {
    title: `Week ${currentWeek.week}: recovery-aware movement`,
    plan: 'Walk, sunlight, mobility, or easy conversational movement if recovery is green.',
    detail: currentWeek.notes || healthPlan?.rules?.[0],
  };
}

function scheduleKey(planId, sourceDay) {
  return `${planId}:${sourceDay}`;
}

function latestScheduleEvents(events) {
  const latest = new Map();
  for (const event of events) {
    if (!event?.planId || !Number.isInteger(Number(event.sourceDay)) || !event.toDate) continue;
    latest.set(scheduleKey(event.planId, Number(event.sourceDay)), event);
  }
  return latest;
}

function recurringBlockForOccurrence(healthPlan, session, occurrenceDate) {
  const schedule = healthPlan?.schedule || {};
  const phase = (healthPlan.progression || [])
    .filter((item) => !item.starts || item.starts <= occurrenceDate)
    .at(-1) || {};
  const rounds = Number(session.rounds || schedule.rounds || 4);
  const durationMin = Number(session.durationMin || schedule.durationMin || 20);
  const exercises = (session.exercises || []).map((exercise) => {
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

  return {
    title: '',
    plan: `${durationMin}-minute EMOM · ${rounds} rounds · ${exercises}`,
    detail: healthPlan.rule || healthPlan.rules?.[0] || 'Move the session when recovery or schedule changes.',
  };
}

function recurringBlockForDate(healthPlan, date, scheduleEvents) {
  const schedule = healthPlan?.schedule || {};
  if (schedule.type !== 'weekly-recurring' || !healthPlan?.startDate) return null;

  const weekdays = (schedule.weekdays || []).map(Number);
  const endDate = schedule.endDate || addDays(healthPlan.startDate, 365);
  const candidates = [];
  let sourceDay = 0;

  for (let occurrenceDate = healthPlan.startDate; occurrenceDate <= endDate; occurrenceDate = addDays(occurrenceDate, 1)) {
    const weekday = new Date(`${occurrenceDate}T00:00:00Z`).getUTCDay();
    if (!weekdays.includes(weekday)) continue;

    const session = (healthPlan.sessions || []).find((item) => Number(item.weekday) === weekday);
    if (!session) continue;
    sourceDay += 1;

    const event = scheduleEvents.get(scheduleKey(healthPlan.id, sourceDay));
    const activeEvent = event && (!healthPlan.startDate || event.fromDate >= healthPlan.startDate)
      ? event
      : null;
    const effectiveDate = activeEvent?.toDate || occurrenceDate;
    if (effectiveDate !== date) continue;

    candidates.push({
      sourceDay,
      block: recurringBlockForOccurrence(healthPlan, session, occurrenceDate),
    });
  }

  return candidates.sort((left, right) => left.sourceDay - right.sourceDay)[0]?.block || null;
}

async function readActiveHealthPlans() {
  const healthRoot = path.join(VAULT_ROOT, 'structured', 'health');
  let entries = [];
  try {
    entries = await fs.readdir(healthRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const plans = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-plan.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(async (entry) => {
      const relativePath = path.join('structured', 'health', entry.name);
      const plan = await readJson(relativePath, null);
      return plan ? { ...plan, sourcePath: relativePath } : null;
    }));

  return plans.filter((plan) => plan && !['paused', 'cancelled', 'archived', 'inactive'].includes(String(plan.status || 'active').toLowerCase()));
}

function healthBlockForDate(plans, date, scheduleEvents) {
  for (const healthPlan of plans) {
    const block = recurringBlockForDate(healthPlan, date, scheduleEvents) || runningBlockForDate(healthPlan, date);
    if (block) return { ...block, source: healthPlan.sourcePath };
  }
  return null;
}

function buildContextReview(plannerItems, captures, today) {
  const activePriorities = plannerItems
    .filter((item) => {
      const status = String(item.status || '').toLowerCase();
      return !['done', 'dropped', 'archived'].includes(status) && item.projectId !== 'routine';
    })
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));

  const priorities = [];
  const representedProjects = new Set();
  for (const item of activePriorities) {
    const projectId = item.projectId || 'inbox';
    if (representedProjects.has(projectId)) continue;
    representedProjects.add(projectId);
    priorities.push({
      projectId,
      area: item.area || 'Admin',
      title: item.title,
      why: item.why || item.detail || '',
    });
    if (priorities.length === 3) break;
  }

  const recentCaptureTitles = captures
    .filter((capture) => daysAgo(capture.created) <= 3)
    .sort((left, right) => new Date(right.created || 0).getTime() - new Date(left.created || 0).getTime())
    .map((capture) => capture.title)
    .filter(Boolean)
    .filter((title) => !/health connect export/i.test(title))
    .filter((title, index, values) => values.indexOf(title) === index)
    .slice(0, 2);

  return {
    title: 'Review priorities and plan',
    period: `Current priorities as of ${today}`,
    summary: priorities.length > 0
      ? 'These are the active cross-project threads to continue, defer, or close before adding more work.'
      : 'No active cross-project priorities are selected yet. Use Planner to choose the next one.',
    priorities,
    recentCaptureTitles,
    source: 'structured/plans/planner-items.json + recent raw captures',
  };
}

async function main() {
  await syncProjectPlanIndex();
  const today = getSydneyDate(0);
  const tomorrow = getSydneyDate(1);
  const captures = (await readJsonl('indexes/captures.jsonl')).filter((entry) => daysAgo(entry.created) <= 30);
  const projectSources = await readJsonl('indexes/project-conversations.jsonl');
  const aiInsights = await readJson('structured/projects/ai-insights.json', null);
  const healthPlans = await readActiveHealthPlans();
  const healthScheduleEvents = latestScheduleEvents(await readJsonl('structured/health/plan-schedule-events.jsonl'));
  const healthState = await readJson('structured/health/health-state.json', null);
  const activityLog = await readJsonl('structured/health/activity-log.jsonl');
  const registry = await readJson('structured/projects/registry.json', { projects: [] });
  const manualPlannerItems = await readJson('structured/plans/planner-items.json', { items: [] });
  const sourceInventory = (await refreshSourceInventory(VAULT_ROOT)).inventory;
  // No Vault file is a default Planner headline. A reviewed, source-linked change
  // summary may be supplied by a later reconciliation step.
  const currentSummary = selectCurrentPlannerSummary(
    await readJsonl('indexes/planner-change-summaries.jsonl'),
    today,
  );

  const capturesByProject = byProject(captures);
  const sourcesByProject = byProject(projectSources);
  const todayActivity = activityLog.slice().reverse().find((entry) => entry.date === today);
  const todayHealth = healthBlockForDate(healthPlans, today, healthScheduleEvents);
  const tomorrowHealth = healthBlockForDate(healthPlans, tomorrow, healthScheduleEvents);
  const recovery = healthState?.procedureRecovery;
  const recoveryHold = recovery?.status === 'needs-clinician-clearance'
    && recovery.holdStart <= today
    && today <= recovery.holdThrough;
  const recoveryTitle = recoveryHold ? 'Sclerotherapy recovery: walk only.' : null;
  const recoveryDetail = recoveryHold
    ? `Walk only through ${recovery.holdThrough}; return to training no earlier than ${recovery.earliestReturnDate} and only after clinician clearance. Planned exercise is paused.`
    : null;
  const healthRule = tomorrowHealth
    ? tomorrowHealth.detail
    : 'Record whatever movement you actually complete; no fixed running session is scheduled.';

  const todayTasks = [];
  if (recoveryHold || todayActivity || todayHealth) {
    todayTasks.push(task({
      id: 'today-health-plan',
      title: recoveryTitle || (todayActivity
        ? `${todayActivity.status === 'partial' ? 'Health partly completed' : 'Health logged'}: ${todayActivity.summary}`
        : todayHealth?.title || 'Health movement baseline.'),
      area: 'Health',
      status: todayActivity?.status === 'partial' ? 'partial' : todayActivity ? 'done' : 'planned',
      source: todayActivity?.rawPath || todayHealth?.source || 'structured/health/health-state.json',
      date: today,
      horizon: 'today',
      priority: 100,
      projectId: 'health',
      detail: recoveryDetail || (todayActivity?.plan?.completedRounds && todayActivity?.plan?.plannedRounds
        ? `${todayActivity.plan.completedRounds} of ${todayActivity.plan.plannedRounds} planned rounds completed. ${todayActivity.calories?.totalEstimatedCalories ? `Estimated burn: ~${todayActivity.calories.totalEstimatedCalories} kcal.` : 'Calories not estimated because completed duration was not recorded.'}`
        : todayActivity?.calories?.totalEstimatedCalories
        ? `Estimated burn: ~${todayActivity.calories.totalEstimatedCalories} kcal.`
        : todayHealth?.plan || 'Log exercise, food, weight, pain, symptoms, or recovery if anything changes.'),
    }));
  }

  const tomorrowTasks = [];
  if (recoveryHold || tomorrowHealth) {
    tomorrowTasks.push(task({
      id: 'tomorrow-health-movement',
      title: recoveryHold
        ? recoveryTitle
        : tomorrowHealth
        ? `${tomorrowHealth.title}: ${tomorrowHealth.plan}`
        : 'Health movement baseline.',
      area: 'Health',
      status: 'planned',
      source: tomorrowHealth?.source || 'structured/health/health-state.json',
      date: tomorrow,
      horizon: 'tomorrow',
      priority: 95,
      projectId: 'health',
      detail: recoveryDetail || tomorrowHealth?.detail || healthRule,
    }));
  }

  // Keep explicit follow-ups outside the generated output so they survive each refresh.
  // Overdue items require an explicit decision and never become today's work automatically.
  const activePlannerItems = (manualPlannerItems.items || [])
    .filter((item) => {
      const status = String(item.status || '').toLowerCase();
      if (['dropped', 'archived'].includes(status)) return false;
      return status !== 'done' || item.completedDate === today;
    });
  const plannerItems = activePlannerItems
    .map((item) => {
      const isOverdue = item.date && item.date < today && item.status !== 'done';
      const needsPlannerReview = Boolean(isOverdue);

      return {
        ...task({
          id: item.id,
          title: item.title,
          area: item.area || 'Admin',
          status: needsPlannerReview ? 'review' : item.status || 'planned',
          source: item.source || 'structured/plans/planner-items.json',
          date: needsPlannerReview ? undefined : item.date,
          horizon: needsPlannerReview ? 'review' : item.horizon || 'this-week',
          priority: item.priority || 50,
          projectId: item.projectId || 'inbox',
          detail: [
            needsPlannerReview ? `Scheduled for ${item.date}; choose tomorrow, later review, or archive.` : '',
            item.detail,
            item.why ? `Why: ${item.why}` : '',
          ].filter(Boolean).join(' '),
        }),
        mutable: true,
        carriedOverFrom: isOverdue ? item.date : undefined,
        needsPlannerReview,
      };
    });

  const projection = {
    title: 'Daily projection from Personal Vault',
    weekFocus: 'Show only explicit commitments and verified active plans. Missing evidence is not a task.',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/generate-daily-projection.mjs',
    projectionVersion: PROJECTION_VERSION,
    windowDays: 30,
    dates: { today, tomorrow },
    generatedFrom: [
      `${captures.length} captures from the last 30 days`,
      `${projectSources.length} project-linked conversations`,
      `${registry.projects?.length || 0} project registry entries`,
      'structured decisions, project notes, health plans, and activity logs',
    ],
    // Health sessions are dynamic schedule state. Today and Health read them from
    // the shared Health resolver, rather than copying them into this static file.
    tasks: [...plannerItems],
    currentSummary,
    contextReview: buildContextReview(plannerItems, captures, today),
    // This is a rebuildable view of readable source changes. It is not a task list
    // and does not alter commitment status or raw Vault files.
    sourceInventory,
    projectSignals: Array.from(new Set([...capturesByProject.keys(), ...sourcesByProject.keys()])).map((projectId) => ({
      projectId,
      captures: capturesByProject.get(projectId)?.length || 0,
      sources: sourcesByProject.get(projectId)?.length || 0,
    })),
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const temporaryOutput = `${OUTPUT_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryOutput, JSON.stringify(projection, null, 2) + '\n', 'utf-8');
    await fs.rename(temporaryOutput, OUTPUT_PATH);
  } catch (error) {
    await fs.rm(temporaryOutput, { force: true }).catch(() => {});
    throw error;
  }
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(JSON.stringify({ today, tomorrow, tasks: projection.tasks.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
