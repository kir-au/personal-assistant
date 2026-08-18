import fs from 'fs/promises';
import path from 'path';
import { syncProjectPlanIndex } from './sync-project-plan-index.mjs';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const OUTPUT_PATH = path.join(VAULT_ROOT, 'structured', 'plans', 'daily-projection.json');

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

function recurringBlockForDate(healthPlan, date) {
  const schedule = healthPlan?.schedule || {};
  if (schedule.type !== 'weekly-recurring' || !healthPlan?.startDate) return null;
  if (date < healthPlan.startDate || (schedule.endDate && date > schedule.endDate)) return null;

  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!(schedule.weekdays || []).map(Number).includes(weekday)) return null;

  const session = (healthPlan.sessions || []).find((item) => Number(item.weekday) === weekday);
  if (!session) return null;

  const phase = (healthPlan.progression || [])
    .filter((item) => !item.starts || item.starts <= date)
    .at(-1) || {};
  const rounds = Number(session.rounds || schedule.rounds || 4);
  const durationMin = Number(session.durationMin || schedule.durationMin || 20);
  const exercises = (session.exercises || []).map((exercise, index) => {
    const baseReps = Number(exercise.baseReps || exercise.reps || 0);
    const reps = exercise.progression === 'press'
      ? Number(phase.pressReps || baseReps)
      : Math.max(1, Math.round(baseReps * Number(phase.repMultiplier || 1)));
    const side = exercise.perSide
      ? '/side'
      : exercise.alternateSides
        ? ' (alternate side each round)'
        : '';
    return `${index + 1}. ${exercise.code || exercise.name} ${reps}${side}`;
  }).join('; ');

  return {
    title: `${session.title}${phase.label ? ` · ${phase.label}` : ''}`,
    plan: `${durationMin}-minute EMOM, ${rounds} rounds. ${exercises}.`,
    detail: healthPlan.rule || healthPlan.rules?.[0] || 'Move the session when recovery or schedule changes.',
  };
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

function healthBlockForDate(plans, date) {
  for (const healthPlan of plans) {
    const block = recurringBlockForDate(healthPlan, date) || runningBlockForDate(healthPlan, date);
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
  const healthState = await readJson('structured/health/health-state.json', null);
  const activityLog = await readJsonl('structured/health/activity-log.jsonl');
  const registry = await readJson('structured/projects/registry.json', { projects: [] });
  const manualPlannerItems = await readJson('structured/plans/planner-items.json', { items: [] });

  const capturesByProject = byProject(captures);
  const sourcesByProject = byProject(projectSources);
  const todayActivity = activityLog.slice().reverse().find((entry) => entry.date === today);
  const todayHealth = healthBlockForDate(healthPlans, today);
  const tomorrowHealth = healthBlockForDate(healthPlans, tomorrow);
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

  const todayTasks = [
    task({
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
    }),
    task({
      id: 'today-ai-projection',
      title: 'Make Today projection regenerate from the vault instead of going stale.',
      area: 'AI',
      status: 'planned',
      source: 'captures.jsonl + structured/projects + current Codex discussion',
      date: today,
      horizon: 'today',
      priority: 90,
      projectId: 'ai',
      detail: 'Generate dated routine, health, and project items for the current day before rendering Today.',
    }),
    task({
      id: 'today-wealth-review',
      title: 'Decide whether the super contribution/tax thread still needs action after EOFY.',
      area: 'Wealth',
      status: 'review',
      source: 'indexes/projects/wealth.json -> Супер-конtribьюшн и налоговые вычеты',
      date: today,
      horizon: 'today',
      priority: 70,
      projectId: 'wealth',
      detail: 'This is not an automatic task; it is a resurfaced review candidate from the Wealth sources.',
    }),
  ];

  const tomorrowTasks = [
    task({
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
    }),
    task({
      id: 'tomorrow-ai-processor',
      title: 'AI backlog: replace heuristic projection with a real review processor.',
      area: 'AI',
      status: 'suggested',
      source: 'structured/projects/ai-backlog.json',
      date: tomorrow,
      horizon: 'tomorrow',
      priority: 90,
      projectId: 'ai',
      detail: 'Why not done: current projection is rule-based and does not yet ask questions, create approval-ready updates, or deeply review raw project context.',
    }),
    task({
      id: 'tomorrow-business-promote-source',
      title: 'Promote one Business source into a concrete next action or mark it as reference.',
      area: 'Business',
      status: 'review',
      source: 'indexes/projects/business.json',
      date: tomorrow,
      horizon: 'tomorrow',
      priority: 65,
      projectId: 'business',
      detail: `${sourcesByProject.get('business')?.length || 0} linked Business sources exist, but no current dated commitment is selected.`,
    }),
  ];

  const reviewQueue = [
    task({
      id: 'review-ai-publishing-series-history',
      title: 'Review the old AI publishing series: drop it, or promote only what still matters.',
      area: 'AI',
      status: 'review',
      source: 'structured/projects/ai-publishing-plan.json + current project dashboard decision logic',
      horizon: 'this-week',
      priority: 95,
      projectId: 'ai',
      detail: 'The June publishing plan is now historical. It should not stay in the active AI project plan unless a specific article is still relevant and gets promoted into the current timeline.',
    }),
    task({
      id: 'review-ai-workstreams',
      title: aiInsights?.suggestedActions?.[0]?.title || 'Define project extraction format.',
      area: 'AI',
      status: 'review',
      source: 'structured/projects/ai-insights.json',
      horizon: 'this-week',
      priority: 85,
      projectId: 'ai',
      detail: aiInsights?.suggestedActions?.[0]?.description || '',
    }),
    task({
      id: 'review-family-context',
      title: 'Keep Family visible but do not turn source history into task debt automatically.',
      area: 'Family',
      status: 'review',
      source: 'indexes/projects/family.json',
      horizon: 'this-week',
      priority: 50,
      projectId: 'family',
      detail: `${sourcesByProject.get('family')?.length || 0} linked Family sources exist. Surface only when there is an explicit commitment or decision.`,
    }),
  ];

  // Keep explicit follow-ups outside the generated output so they survive each refresh.
  const plannerItems = (manualPlannerItems.items || [])
    .filter((item) => {
      const status = String(item.status || '').toLowerCase();
      if (['dropped', 'archived'].includes(status)) return false;
      if (item.projectId === 'routine') return false;
      return status !== 'done' || item.completedDate === today;
    })
    .map((item) => {
      const isOverdue = item.date && item.date < today && item.status !== 'done';
      const scheduledDate = isOverdue ? today : item.date;

      return {
        ...task({
      id: item.id,
      title: item.title,
      area: item.area || 'Admin',
      status: item.status || 'planned',
      source: item.source || 'structured/plans/planner-items.json',
      date: scheduledDate,
      horizon: isOverdue ? 'today' : item.horizon || 'this-week',
      priority: item.priority || 50,
      projectId: item.projectId || 'inbox',
      detail: [isOverdue ? `Carried over from ${item.date}.` : '', item.detail, item.why ? `Why: ${item.why}` : ''].filter(Boolean).join(' '),
        }),
        mutable: true,
        carriedOverFrom: isOverdue ? item.date : undefined,
      };
    });

  const projection = {
    title: 'Daily projection from Personal Vault',
    weekFocus: 'Use recent captures and project sources to choose a small number of visible commitments. Routine stays in the projects where it matters, not as a separate default task.',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/generate-daily-projection.mjs',
    windowDays: 30,
    dates: { today, tomorrow },
    generatedFrom: [
      `${captures.length} captures from the last 30 days`,
      `${projectSources.length} project-linked conversations`,
      `${registry.projects?.length || 0} project registry entries`,
      'structured decisions, project notes, health plans, and activity logs',
    ],
    tasks: [...todayTasks, ...tomorrowTasks, ...reviewQueue, ...plannerItems],
    contextReview: buildContextReview(plannerItems, captures, today),
    projectSignals: Array.from(new Set([...capturesByProject.keys(), ...sourcesByProject.keys()])).map((projectId) => ({
      projectId,
      captures: capturesByProject.get(projectId)?.length || 0,
      sources: sourcesByProject.get(projectId)?.length || 0,
    })),
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(projection, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(JSON.stringify({ today, tomorrow, tasks: projection.tasks.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
