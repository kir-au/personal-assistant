import fsp from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
export const GOOGLE_CALENDAR_SNAPSHOT_RELATIVE_PATH =
  'structured/integrations/google-calendar/events.json';
const GOOGLE_CALENDAR_SNAPSHOT_PATH = path.join(
  VAULT_ROOT,
  GOOGLE_CALENDAR_SNAPSHOT_RELATIVE_PATH
);

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  transparency?: 'opaque' | 'transparent' | null;
}

interface GoogleCalendarSnapshot {
  version: number;
  provider: 'google-calendar';
  calendarId: string;
  syncedAt: string;
  timeZone: string;
  window: {
    timeMin: string;
    timeMax: string;
  };
  events: GoogleCalendarEvent[];
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function eventDate(event: GoogleCalendarEvent) {
  return event.start.slice(0, 10);
}

function isStale(syncedAt: string) {
  const syncedTime = new Date(syncedAt).getTime();
  if (Number.isNaN(syncedTime)) return true;
  return Date.now() - syncedTime > 6 * 60 * 60 * 1000;
}

export async function readGoogleCalendarForDate(date: string) {
  if (!isDate(date)) {
    return {
      events: [] as GoogleCalendarEvent[],
      sync: {
        connected: false,
        syncedAt: null,
        stale: true,
        timeZone: 'Australia/Sydney',
      },
    };
  }

  try {
    const raw = await fsp.readFile(GOOGLE_CALENDAR_SNAPSHOT_PATH, 'utf-8');
    const snapshot = JSON.parse(raw) as GoogleCalendarSnapshot;
    const events = Array.isArray(snapshot.events)
      ? snapshot.events
          .filter((event) => event?.id && event?.title && eventDate(event) === date)
          .sort((a, b) => a.start.localeCompare(b.start))
      : [];

    return {
      events,
      sync: {
        connected: snapshot.provider === 'google-calendar',
        syncedAt: snapshot.syncedAt || null,
        stale: isStale(snapshot.syncedAt),
        timeZone: snapshot.timeZone || 'Australia/Sydney',
        window: snapshot.window || null,
      },
    };
  } catch {
    return {
      events: [] as GoogleCalendarEvent[],
      sync: {
        connected: false,
        syncedAt: null,
        stale: true,
        timeZone: 'Australia/Sydney',
      },
    };
  }
}
