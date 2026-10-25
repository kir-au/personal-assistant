import fsp from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const COMPLETION_EVENTS_PATH = path.join(
  VAULT_ROOT,
  'structured',
  'health',
  'plan-completion-events.jsonl'
);

export interface HealthCompletionEvent {
  id: string;
  type: 'complete';
  planId: string;
  sourceDay: number;
  completedDate: string;
  created: string;
  source: 'health-dashboard' | 'capture-processor';
  rawPath?: string;
}

export async function readLatestHealthCompletionEvents() {
  const events = await readHealthCompletionEvents();
  const latest = new Map<string, HealthCompletionEvent>();

  for (const event of events) latest.set(completionKey(event.planId, event.sourceDay), event);
  return latest;
}

export async function appendHealthCompletionEvent(
  event: Omit<HealthCompletionEvent, 'id' | 'created' | 'type'>
) {
  const created = new Date().toISOString();
  const completionEvent: HealthCompletionEvent = {
    ...event,
    id: `health-completion-${created.replace(/[:.]/g, '-')}`,
    type: 'complete',
    created,
  };

  await fsp.mkdir(path.dirname(COMPLETION_EVENTS_PATH), { recursive: true });
  await fsp.appendFile(COMPLETION_EVENTS_PATH, `${JSON.stringify(completionEvent)}\n`, 'utf-8');
  return completionEvent;
}

export function completionKey(planId: string, sourceDay: number) {
  return `${planId}:${sourceDay}`;
}

async function readHealthCompletionEvents() {
  try {
    const raw = await fsp.readFile(COMPLETION_EVENTS_PATH, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const event = JSON.parse(line) as HealthCompletionEvent;
          if (
            event.type !== 'complete'
            || !event.planId
            || !Number.isInteger(event.sourceDay)
            || !isDateValue(event.completedDate)
          ) {
            return [];
          }
          return [event];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function isDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
