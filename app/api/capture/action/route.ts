import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { appendHealthCompletionEvent } from '@/lib/healthCompletion';
import { readHealthPlans } from '@/lib/healthPlans';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const SHOULDER_REHAB_PLAN_PATH = path.join(VAULT_ROOT, 'structured', 'health', 'shoulder-rehab-plan.json');
const SHOULDER_REHAB_LOG_PATH = path.join(VAULT_ROOT, 'structured', 'health', 'shoulder-rehab-log.json');
const HEALTH_STATE_PATH = path.join(VAULT_ROOT, 'structured', 'health', 'health-state.json');

type CompletedActivity = {
  code: string;
  name: string;
  load: string | null;
  sets: number | null;
  reps: number | null;
};

type CaptureActionId =
  | 'leave-in-inbox'
  | 'link-to-project'
  | 'add-today-achievement'
  | 'add-to-today-plan'
  | 'apply-structured-update';

interface CaptureActionRequest {
  path: string;
  actionId: CaptureActionId;
  projectId?: string;
  processorId?: string;
  recordType?: string;
  note?: string;
}

function safeRelativeVaultPath(value: string) {
  const normalized = value.replace(/^\/+/, '');
  const full = path.resolve(VAULT_ROOT, normalized);
  if (!full.startsWith(VAULT_ROOT + path.sep)) throw new Error('Path outside vault');
  return { relative: normalized, full };
}

function safeProjectId(value?: string) {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return normalized || undefined;
}

async function appendJsonl(relativePath: string, entry: Record<string, unknown>) {
  const fullPath = path.join(VAULT_ROOT, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.appendFile(fullPath, JSON.stringify(entry) + '\n', 'utf-8');
}

function getSydneyDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function textBodyFromMarkdown(markdown: string) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('- ');
    })
    .join(' ')
    .trim();
}

function exerciseName(code: string) {
  const names: Record<string, string> = {
    CSR: 'Chest Supported Row',
    SCR: 'Seated Cable Row',
    GFP: 'Cable Face Pull',
    C: 'Suitcase / Farmer Carry',
    P: 'Pendulum',
    W: 'Wall Slides',
    KAW: 'Kettlebell Around-the-Waist Pass',
    BP: 'Chest Bench Press',
    KBS: 'Russian Kettlebell Swings',
    cycling: 'Cycling',
    bike: 'Bike',
  };
  return names[code] || code;
}

function parseWorkout(markdown: string) {
  const body = textBodyFromMarkdown(markdown);
  const completed: CompletedActivity[] = [];

  const csr = body.match(/\bCSR\b.*?(\d+)\s*sets?.*?(\d+)\s*kg.*?(\d+)\s*reps?/i);
  if (csr) {
    completed.push({
      code: 'CSR',
      name: exerciseName('CSR'),
      sets: Number(csr[1]),
      load: `${csr[2]} kg`,
      reps: Number(csr[3]),
    });
  }

  const facePull = body.match(/(?:face pull|тяга к лбу).*?(\d+)\s*kg/i);
  if (facePull) {
    completed.push({
      code: 'GFP',
      name: exerciseName('GFP'),
      load: `${facePull[1]} kg`,
      sets: null,
      reps: null,
    });
  }

  const scr = body.match(/\bSCR\b.*?(\d+)\s*kg.*?(\d+)\s*sets?/i);
  if (scr) {
    completed.push({
      code: 'SCR',
      name: exerciseName('SCR'),
      load: `${scr[1]} kg`,
      sets: Number(scr[2]),
      reps: null,
    });
  }

  const carry = body.match(/(?:farmer'?s? carry|farmers carry|farmer carry|carry).*?(\d+)\s*(?:times|sets?|раза|раз)?.*?(\d+)\s*kg/i)
    || body.match(/(?:farmer'?s? carry|farmers carry|farmer carry|carry).*?(\d+)\s*kg.*?(\d+)\s*(?:times|sets?|раза|раз)/i);
  if (carry) {
    const first = Number(carry[1]);
    const second = Number(carry[2]);
    const firstIsLoad = /kg/i.test(carry[0].slice(carry[0].indexOf(carry[1]), carry[0].indexOf(carry[2])));
    completed.push({
      code: 'C',
      name: exerciseName('C'),
      load: `${firstIsLoad ? first : second} kg`,
      sets: firstIsLoad ? second : first,
      reps: null,
    });
  }

  if (/(?:walk|ходьб|прогулк).*?(?:done|completed|сделан|был сделан|закрыт|закрой|earlier|раньше|намного больше)/i.test(body)) {
    completed.push({
      code: 'walk',
      name: 'Walk',
      load: null,
      sets: null,
      reps: null,
    });
  }

  const pendulum = body.match(/(?:\bP\b|pendulum).*?(\d+)\s*min/i);
  if (pendulum) {
    completed.push({
      code: 'P',
      name: exerciseName('P'),
      load: null,
      sets: null,
      reps: null,
    });
  }

  const wall = body.match(/(?:\bW\b|wall(?:\s+slides?| exercises?)?).*?(\d+)\s*[x×]\s*(\d+)/i);
  if (wall) {
    completed.push({
      code: 'W',
      name: exerciseName('W'),
      load: null,
      sets: Number(wall[1]),
      reps: Number(wall[2]),
    });
  }

  const kaw = body.match(/(?:\bKAW\b|kettlebell around(?: |-)?the(?: |-)?waist|around(?: |-)?the(?: |-)?waist).*?(\d+)\s*(?:easy\s*)?(?:sets?|times?|раза|раз)?/i);
  if (kaw) {
    completed.push({
      code: 'KAW',
      name: exerciseName('KAW'),
      load: null,
      sets: Number(kaw[1]),
      reps: null,
    });
  }

  const kettlebellSwings =
    body.match(/(\d+)\s*(?:russian\s+)?kettlebell\s+swings?\b/i)
    || body.match(/(?:russian\s+)?kettlebell\s+swings?\b.*?(\d+)\s*(?:reps?|повтор)/i);
  if (kettlebellSwings) {
    completed.push({
      code: 'KBS',
      name: exerciseName('KBS'),
      load: null,
      sets: null,
      reps: Number(kettlebellSwings[1]),
    });
  }

  const cycling =
    body.match(/(\d+)\s*(?:minutes?|mins?|мин(?:ут)?\.?)\s*(?:of\s+)?(?:cycling|bike|biking|велосипед|сайкл)/i)
    || body.match(/(?:cycling|bike|biking|велосипед|сайкл).*?(\d+)\s*(?:minutes?|mins?|мин(?:ут)?\.?)/i);
  if (cycling) {
    completed.push({
      code: 'cycling',
      name: exerciseName('cycling'),
      load: `${cycling[1]} min`,
      sets: null,
      reps: null,
    });
  }

  if (/bench/i.test(body)) {
    const benchBlocks = Array.from(body.matchAll(/(\d+)\s*sets?\s*[x×]\s*(\d+)\s*kg/gi));
    for (const bench of benchBlocks) {
      completed.push({
        code: 'BP',
        name: exerciseName('BP'),
        load: `${bench[2]} kg`,
        sets: Number(bench[1]),
        reps: null,
      });
    }
  }

  return { reportedText: body, completed };
}

function mergeCompleted(
  existing: CompletedActivity[] = [],
  incoming: CompletedActivity[]
) {
  const mergeKey = (item: CompletedActivity) => {
    const load = item.load ? `:${item.load}` : '';
    const reps = item.reps ? `:${item.reps}reps` : '';
    const sets = item.sets ? `:${item.sets}sets` : '';
    return `${item.code}${load}${sets}${reps}`;
  };
  const byCode = new Map(existing.map((item) => [mergeKey(item), item]));
  for (const item of incoming) {
    byCode.set(mergeKey(item), item);
  }
  return Array.from(byCode.values());
}

async function applyHealthActivityUpdate(capturePath: { relative: string; full: string }, appliedAt: string) {
  const markdown = await fs.readFile(capturePath.full, 'utf-8');
  const parsed = parseWorkout(markdown);
  const recurringCompletion = await applyRecurringPlanCompletion(capturePath.relative, parsed.reportedText);
  if (recurringCompletion.applied) return recurringCompletion;
  if (!parsed.completed.length) {
    return { applied: false, reason: 'No supported workout exercises parsed from capture.' };
  }

  const today = getSydneyDate();
  const [planRaw, logRaw, stateRaw] = await Promise.all([
    fs.readFile(SHOULDER_REHAB_PLAN_PATH, 'utf-8'),
    fs.readFile(SHOULDER_REHAB_LOG_PATH, 'utf-8').catch(() => '{"projectId":"shoulder-rehab","entries":[]}'),
    fs.readFile(HEALTH_STATE_PATH, 'utf-8').catch(() => '{}'),
  ]);

  const plan = JSON.parse(planRaw);
  const log = JSON.parse(logRaw);
  const state = JSON.parse(stateRaw);
  const day = Array.isArray(plan.days) ? plan.days.find((item: any) => item.date === today) : null;
  if (!day) {
    return { applied: false, reason: `No shoulder rehab day found for ${today}.` };
  }

  const existingActual = day.actual || {};
  const completed = mergeCompleted(existingActual.completed || [], parsed.completed);
  const completedCodes = new Set(completed.map((item) => item.code));
  const plannedCodes: string[] = Array.from(new Set((day.plan.match(/\b(?:CSR|SCR|GFP|FP|C|walk|P|W|KAW|ER|IR|RF|LP|SAR|KBR)\b/gi) || [])
    .map((code: string) => {
      const normalized = code.toUpperCase();
      if (normalized === 'FP') return 'GFP';
      if (normalized === 'WALK') return 'walk';
      return normalized;
    })));
  const plannedRemaining = plannedCodes
    .filter((code) => !completedCodes.has(code))
    .map((code) => {
      if (code === 'C') return 'C 4x30 sec/side';
      if (code === 'walk') return 'walk 20 min';
      if (code === 'GFP') return 'GFP 3x15';
      if (code === 'CSR') return 'CSR 3x10';
      if (code === 'SCR') return 'SCR 3x10';
      if (code === 'P') return 'P 2 min';
      if (code === 'W') return 'W 2x10';
      if (code === 'KAW') return 'KAW 2 easy sets';
      return code;
    });

  const logEntry = {
    date: today,
    loggedAt: appliedAt,
    planWeek: Math.ceil(day.day / 7),
    planDay: day.day,
    session: day.title,
    status: plannedRemaining.length ? 'partial' : 'completed',
    source: 'capture-action',
    rawPath: capturePath.relative,
    reportedText: parsed.reportedText,
    completed: parsed.completed,
    plannedRemaining,
    painResponse: {
      during: null,
      night: null,
      nextDay: null,
    },
    notes: [
      'Logged through /api/capture/action.',
      ...parsed.completed
        .filter((item) => !plannedCodes.includes(item.code) && item.code !== 'walk')
        .map((item) => `${item.code} is logged as off-plan activity for this rehab day.`),
      ...(parsed.completed.some((item) => item.code === 'SCR' && item.reps == null) ? ['SCR reps were not confirmed.'] : []),
      ...(parsed.completed.some((item) => item.code === 'GFP' && (item.sets == null || item.reps == null)) ? ['Face pull sets and reps were not stated.'] : []),
    ],
  };

  log.updatedAt = appliedAt;
  log.projectId = log.projectId || 'shoulder-rehab';
  log.entries = Array.isArray(log.entries) ? log.entries : [];
  const existingLogIndex = log.entries.findIndex((entry: any) => entry.rawPath === capturePath.relative);
  if (existingLogIndex >= 0) {
    log.entries[existingLogIndex] = logEntry;
  } else {
    log.entries.push(logEntry);
  }

  day.completed = plannedRemaining.length === 0;
  day.completionStatus = plannedRemaining.length ? 'partial' : 'completed';
  day.loggedAt = appliedAt;
  day.actual = {
    ...existingActual,
    rawPath: capturePath.relative,
    summary: completed.map((item) => {
      const load = item.load ? ` ${item.load}` : '';
      const sets = item.sets ? ` ${item.sets} sets` : '';
      const reps = item.reps ? ` x ${item.reps} reps` : '';
      return `${item.code}${load}${sets}${reps}`;
    }).join('; '),
    completed,
    remaining: plannedRemaining,
    painResponse: existingActual.painResponse || {
      during: null,
      night: null,
      nextDay: null,
    },
  };

  state.updatedAt = appliedAt;
  state.lastWorkout = {
    date: today,
    loggedAt: appliedAt,
    planWeek: Math.ceil(day.day / 7),
    planDay: day.day,
    session: day.title,
    status: day.completionStatus,
    summary: day.actual.summary,
    rawPath: capturePath.relative,
  };
  state.openQuestions = [
    ...(parsed.completed.some((item) => item.code === 'SCR' && item.reps == null) ? ['Confirm SCR reps.'] : []),
    ...(parsed.completed.some((item) => item.code === 'GFP' && (item.sets == null || item.reps == null)) ? ['Confirm face pull sets and reps.'] : []),
    ...(plannedRemaining.some((item) => item.toLowerCase().includes('walk')) ? ['Was the walk completed?'] : []),
    `Any pain during the session, night pain, or next-day pain after Day ${day.day}?`,
  ];

  await Promise.all([
    fs.writeFile(SHOULDER_REHAB_PLAN_PATH, JSON.stringify(plan, null, 2) + '\n', 'utf-8'),
    fs.writeFile(SHOULDER_REHAB_LOG_PATH, JSON.stringify(log, null, 2) + '\n', 'utf-8'),
    fs.writeFile(HEALTH_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8'),
  ]);

  return { applied: true, planDay: day.day, date: today, completed };
}

async function applyRecurringPlanCompletion(rawPath: string, body: string) {
  const health = await readHealthPlans();
  const session = health.days.find((day) => (
    day.date === health.todayDate
    && day.kind === 'kettlebell'
    && !day.completed
    && day.planId
    && day.sourceDay
  ));
  if (!session?.planId || !session.sourceDay) {
    return { applied: false, reason: 'No due recurring kettlebell session found.' };
  }

  const exerciseCodes = Array.from(new Set(session.plan.match(/\b[A-Z]{2,4}\b/g) || []));
  const explicitlyComplete = /(?:full|entire|whole|all\s+(?:four|4)|4\s*\/\s*4).{0,30}(?:workout|session|circuit|rounds)|(?:workout|session|circuit).{0,20}(?:done|complete(?:d)?|finished)|(?:сделал|закончил).{0,25}(?:всю|полностью|тренировк|сесси|круг)/i.test(body);
  const explicitlyPartial = /(?:partial|not\s+complete|stopped|не\s+доделал|частично|\b[123]\s*(?:of|из)\s*4\b|\b[123]\s+rounds?\b)/i.test(body);
  const namesEveryExercise = exerciseCodes.length > 0
    && exerciseCodes.every((code) => new RegExp(`\\b${code}\\b`, 'i').test(body));

  if (!explicitlyComplete || explicitlyPartial || !namesEveryExercise) {
    return { applied: false, reason: 'The capture does not explicitly confirm the complete current kettlebell session.' };
  }

  const event = await appendHealthCompletionEvent({
    planId: session.planId,
    sourceDay: session.sourceDay,
    completedDate: health.todayDate,
    source: 'capture-processor',
    rawPath,
  });
  return {
    applied: true,
    planId: session.planId,
    sourceDay: session.sourceDay,
    date: health.todayDate,
    completionEvent: event.id,
  };
}

async function applyStructuredUpdate(request: {
  capturePath: { relative: string; full: string };
  appliedAt: string;
  processorId?: string;
  projectId?: string;
  recordType?: string;
}) {
  if (request.processorId === 'health.activity' || (request.projectId === 'health' && request.recordType === 'activity_log')) {
    return {
      processorId: 'health.activity',
      recordType: 'activity_log',
      result: await applyHealthActivityUpdate(request.capturePath, request.appliedAt),
    };
  }

  return {
    processorId: request.processorId || null,
    recordType: request.recordType || null,
    result: {
      applied: false,
      reason: `No structured processor registered for ${request.processorId || request.projectId || 'unknown target'}.`,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CaptureActionRequest;
    if (!body.path || !body.actionId) {
      return NextResponse.json({ ok: false, error: 'Missing path or actionId' }, { status: 400 });
    }

    const capturePath = safeRelativeVaultPath(body.path);
    await fs.access(capturePath.full);

    const now = new Date().toISOString();
    const projectId = safeProjectId(body.projectId);
    const baseEntry = {
      appliedAt: now,
      actionId: body.actionId,
      path: capturePath.relative,
      projectId: projectId || null,
      processorId: body.processorId || null,
      recordType: body.recordType || null,
      note: body.note || null,
      status: 'pending',
    };

    await appendJsonl('indexes/capture-actions.jsonl', baseEntry);

    if (body.actionId === 'link-to-project') {
      if (!projectId) {
        return NextResponse.json({ ok: false, error: 'Missing projectId for link-to-project' }, { status: 400 });
      }
      await appendJsonl('indexes/project-captures.jsonl', baseEntry);
    }

    if (body.actionId === 'add-today-achievement') {
      await appendJsonl('structured/today/achievements.jsonl', baseEntry);
    }

    if (body.actionId === 'add-to-today-plan') {
      await appendJsonl('structured/today/plan-overrides.jsonl', baseEntry);
    }

    if (body.actionId === 'apply-structured-update') {
      await appendJsonl('indexes/structured-updates.jsonl', baseEntry);
      const structuredResult = await applyStructuredUpdate({
        capturePath,
        appliedAt: now,
        processorId: body.processorId,
        projectId,
        recordType: body.recordType,
      });
      return NextResponse.json({ ok: true, action: baseEntry, structuredResult });
    }

    return NextResponse.json({ ok: true, action: baseEntry });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
