import { NextRequest, NextResponse } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';
import { readHealthConnectActivityLog } from '@/lib/healthConnect';
import {
  GOOGLE_CALENDAR_SNAPSHOT_RELATIVE_PATH,
  readGoogleCalendarForDate,
} from '@/lib/googleCalendarSnapshot';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const CAPTURES_INDEX_PATH = path.join(VAULT_ROOT, 'indexes', 'captures.jsonl');
const HEALTH_ACTIVITY_LOG_PATH = path.join(VAULT_ROOT, 'structured', 'health', 'activity-log.jsonl');
const CAPTURE_REVIEWS_INDEX_PATH = path.join(VAULT_ROOT, 'indexes', 'codex-capture-reviews.jsonl');
const REVIEW_ANSWERS_INDEX_PATH = path.join(VAULT_ROOT, 'indexes', 'capture-review-answers.jsonl');

interface CaptureIndexEntry {
  created?: string;
  source?: string;
  intent?: string;
  projectId?: string | null;
  path?: string;
  title?: string;
}

interface HealthActivityEntry {
  date?: string;
  summary?: string;
  status?: string;
  rawPath?: string;
  calories?: {
    totalEstimatedCalories?: number;
    method?: string;
    quality?: string;
  };
  activities?: Array<{
    code?: string;
    name?: string;
    durationMin?: number;
    distanceKm?: number | null;
    load?: string | null;
    reps?: number | null;
    estimatedCalories?: number;
  }>;
}

interface CaptureReviewIndexEntry {
  capturePath?: string;
  reviewPath?: string;
  created?: string;
}

interface CaptureReview {
  capturePath?: string;
  interpretation?: string;
  questions?: string[];
  proposals?: Array<{
    label?: string;
    reason?: string;
  }>;
  approvalRequired?: boolean;
}

interface CaptureReviewAnswer {
  reviewPath?: string;
  capturePath?: string;
  question?: string;
  status?: string;
}

function readJsonl<T>(raw: string): T[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

function localDateFromIso(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dateFromCapture(entry: CaptureIndexEntry) {
  const pathDate = entry.path?.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})-/)?.[1];
  return pathDate || localDateFromIso(entry.created);
}

async function readCapturesForDate(date: string) {
  try {
    const raw = await fsp.readFile(CAPTURES_INDEX_PATH, 'utf-8');
    return readJsonl<CaptureIndexEntry>(raw)
      .filter((entry) => dateFromCapture(entry) === date)
      .map((entry) => ({
        title: entry.title || entry.path?.split('/').pop()?.replace(/\.md$/, '') || 'Capture',
        path: entry.path || null,
        source: entry.source || 'capture',
        intent: entry.intent || 'note',
        projectId: entry.projectId || null,
        created: entry.created || null,
      }));
  } catch {
    return [];
  }
}

async function readHealthActivitiesForDate(date: string) {
  try {
    const raw = await fsp.readFile(HEALTH_ACTIVITY_LOG_PATH, 'utf-8');
    const manualActivities = readJsonl<HealthActivityEntry>(raw)
      .filter((entry) => entry.date === date)
      .map((entry) => ({
        summary: entry.summary || 'Health activity logged',
        status: entry.status || 'logged',
        rawPath: entry.rawPath || null,
        calories: entry.calories?.totalEstimatedCalories ?? null,
        caloriesMethod: entry.calories?.method || 'MET estimate',
        caloriesQuality: entry.calories?.quality || 'estimated',
        activities: entry.activities || [],
      }));
    const syncedActivities = await readHealthConnectActivityLog()
      .then((entries) => entries
        .filter((entry) => entry.date === date)
        .map((entry) => ({
          summary: entry.summary,
          status: entry.status,
          rawPath: entry.rawPath,
          calories: entry.calories?.totalEstimatedCalories ?? null,
          caloriesMethod: entry.calories?.method || 'Fitbit energy via Health Connect',
          caloriesQuality: entry.calories?.quality || 'unverified',
          activities: entry.activities || [],
        })));
    return [...manualActivities, ...syncedActivities];
  } catch {
    return readHealthConnectActivityLog().then((entries) => entries
      .filter((entry) => entry.date === date)
      .map((entry) => ({
        summary: entry.summary,
        status: entry.status,
        rawPath: entry.rawPath,
        calories: entry.calories?.totalEstimatedCalories ?? null,
        caloriesMethod: entry.calories?.method || 'Fitbit energy via Health Connect',
        caloriesQuality: entry.calories?.quality || 'unverified',
        activities: entry.activities || [],
      })));
  }
}

async function readPendingReviewsForCaptures(capturePaths: string[]) {
  if (capturePaths.length === 0) return [];

  try {
    const raw = await fsp.readFile(CAPTURE_REVIEWS_INDEX_PATH, 'utf-8');
    const reviewEntries = readJsonl<CaptureReviewIndexEntry>(raw)
      .filter((entry) => entry.capturePath && capturePaths.includes(entry.capturePath) && entry.reviewPath);

    const latestByCapture = new Map<string, CaptureReviewIndexEntry>();
    for (const entry of reviewEntries) {
      const current = latestByCapture.get(entry.capturePath!);
      if (!current || String(entry.created || '') > String(current.created || '')) {
        latestByCapture.set(entry.capturePath!, entry);
      }
    }

    const reviews = await Promise.all(
      Array.from(latestByCapture.values()).map(async (entry) => {
        try {
          const reviewRaw = await fsp.readFile(path.join(VAULT_ROOT, entry.reviewPath!), 'utf-8');
          const review = JSON.parse(reviewRaw) as CaptureReview;
          return {
            capturePath: entry.capturePath!,
            reviewPath: entry.reviewPath!,
            interpretation: review.interpretation || '',
            questions: review.questions || [],
            proposals: review.proposals || [],
            approvalRequired: review.approvalRequired ?? true,
          };
        } catch {
          return null;
        }
      })
    );

    return reviews.filter((review): review is NonNullable<typeof review> => Boolean(review));
  } catch {
    return [];
  }
}

async function readAnsweredQuestionKeys() {
  try {
    const raw = await fsp.readFile(REVIEW_ANSWERS_INDEX_PATH, 'utf-8');
    return new Set(
      readJsonl<CaptureReviewAnswer>(raw)
        .filter((answer) => answer.status === 'answered' && answer.reviewPath && answer.question)
        .map((answer) => `${answer.reviewPath}::${answer.question}`)
    );
  } catch {
    return new Set<string>();
  }
}

export async function GET(request: NextRequest) {
  const requestedDate = request.nextUrl.searchParams.get('date');
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Sydney',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

  const [captures, healthActivities, calendar] = await Promise.all([
    readCapturesForDate(date),
    readHealthActivitiesForDate(date),
    readGoogleCalendarForDate(date),
  ]);
  const [reviews, answeredQuestionKeys] = await Promise.all([
    readPendingReviewsForCaptures(captures.map((capture) => capture.path).filter(Boolean) as string[]),
    readAnsweredQuestionKeys(),
  ]);
  const pendingQuestions = reviews.flatMap((review) =>
    review.questions
      .filter((question) => !answeredQuestionKeys.has(`${review.reviewPath}::${question}`))
      .map((question) => ({
        question,
        capturePath: review.capturePath,
        reviewPath: review.reviewPath,
        interpretation: review.interpretation,
        proposals: review.proposals,
        approvalRequired: review.approvalRequired,
      }))
  );

  const captureTitles = captures.slice(0, 4).map((capture) => capture.title);
  const healthSummary = healthActivities.map((activity) => activity.summary);
  const calendarSummary = calendar.events.slice(0, 4).map((event) => event.title);
  const changedSummary =
    captures.length || healthActivities.length || calendar.events.length
      ? [
          captures.length ? `${captures.length} capture(s): ${captureTitles.join(', ')}` : null,
          healthSummary.length ? `Health: ${healthSummary.join('; ')}` : null,
          calendarSummary.length
            ? `Calendar: ${calendar.events.length} event(s): ${calendarSummary.join(', ')}`
            : null,
        ].filter(Boolean).join('. ')
      : 'No captures, health records, or calendar events found for this day yet.';

  return NextResponse.json({
    date,
    captures,
    healthActivities,
    calendarEvents: calendar.events,
    calendarSync: calendar.sync,
    reviews,
    pendingQuestions,
    changedSummary,
    sourcePaths: [
      'indexes/captures.jsonl',
      'structured/health/activity-log.jsonl',
      'indexes/health-connect-imports.jsonl',
      'indexes/codex-capture-reviews.jsonl',
      GOOGLE_CALENDAR_SNAPSHOT_RELATIVE_PATH,
    ],
  });
}
