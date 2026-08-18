#!/usr/bin/env node

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:3319/api/activity?limit=1000';

function readOption(argumentsList, name, fallback = null) {
  const index = argumentsList.indexOf(name);
  return index >= 0 ? argumentsList[index + 1] || fallback : fallback;
}

function dateFromEvent(event) {
  return /^\d{4}-\d{2}-\d{2}$/.test(event.date || '')
    ? event.date
    : new Date(event.occurredAt).toISOString().slice(0, 10);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readJsonLines(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function tradeText(trade) {
  if (!trade) return 'unknown trade';
  const target = trade.takeProfit?.price ? `; take-profit ${trade.takeProfit.price}` : '';
  return `${trade.id} · ${trade.instrument} · ${trade.units} @ ${trade.entryPrice}${target}`;
}

function orderText(order) {
  if (!order) return 'unknown order';
  return `${order.id} · ${order.type} · ${order.instrument || '—'} · ${order.units || '—'} @ ${order.price || 'market'}`;
}

function describe(event) {
  switch (event.type) {
    case 'baseline-snapshot': {
      const snapshot = event.data?.snapshot;
      return `Initial observed state: ${Object.keys(snapshot?.trades || {}).length} open trade(s), ${Object.keys(snapshot?.orders || {}).length} pending order(s); cycle ${snapshot?.automation?.phase || 'unknown'}.`;
    }
    case 'daily-snapshot': {
      const snapshot = event.data?.snapshot;
      return `Daily snapshot: ${Object.keys(snapshot?.trades || {}).length} open trade(s), ${Object.keys(snapshot?.orders || {}).length} pending order(s); cycle ${snapshot?.automation?.phase || 'unknown'}.`;
    }
    case 'trade-opened': return `Opened: ${tradeText(event.data?.trade)}.`;
    case 'trade-closed': return `Closed: ${tradeText(event.data?.trade)}.`;
    case 'trade-changed': return `Changed protection/units: ${tradeText(event.data?.before)} → ${tradeText(event.data?.after)}.`;
    case 'order-created': return `Created order: ${orderText(event.data?.order)}.`;
    case 'order-removed': return `Removed or filled order: ${orderText(event.data?.order)}.`;
    case 'order-changed': return `Changed order: ${orderText(event.data?.before)} → ${orderText(event.data?.after)}.`;
    case 'automation-changed': return `Cycle changed: ${event.data?.before?.phase || 'unknown'} → ${event.data?.after?.phase || 'unknown'}.`;
    default: return `Observed ${event.type || 'unknown'} event.`;
  }
}

function markdownFor(events, importedAt) {
  return [
    `## Import ${importedAt}`,
    '',
    ...events.flatMap((event) => [
      `- ${event.occurredAt} — **${event.type}** — ${describe(event)}`,
    ]),
    '',
  ].join('\n');
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const vaultRoot = path.resolve(readOption(argv, '--vault', path.join(process.env.HOME || '', 'personal-vault')));
const endpoint = readOption(argv, '--endpoint', DEFAULT_ENDPOINT);
const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
if (!response.ok) throw new Error(`OANDA activity endpoint returned ${response.status}.`);
const payload = await response.json();
const events = Array.isArray(payload.activity) ? payload.activity : [];
const importStatePath = path.join(vaultRoot, 'structured', 'trading', 'oanda', 'import-state.json');
const activityPath = path.join(vaultRoot, 'structured', 'trading', 'oanda', 'activity.jsonl');
const importState = await readJson(importStatePath, { version: 1, importedEventIds: [] });
const known = new Set(Array.isArray(importState.importedEventIds) ? importState.importedEventIds : []);
const unseen = events.filter((event) => event?.id && !known.has(event.id));

if (!write) {
  console.log(JSON.stringify({ mode: 'dry-run', endpoint, received: events.length, unseen: unseen.length }, null, 2));
  process.exit(0);
}

const importedAt = new Date().toISOString();
const grouped = Map.groupBy(unseen, dateFromEvent);
for (const [date, dayEvents] of grouped) {
  const [year, month] = date.split('-');
  const rawPath = path.join(vaultRoot, 'raw', year, month, `${date}-oanda-au200-activity.md`);
  try {
    await readFile(rawPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(path.dirname(rawPath), { recursive: true });
    await writeFile(rawPath, [
      '---',
      'title: OANDA AU200 activity',
      'project: trading',
      'source: oanda-engine',
      `date: ${date}`,
      '---',
      '',
      '# OANDA AU200 activity',
      '',
      'Append-only import of the read-only OANDA engine activity journal. It contains no API credentials and does not control orders.',
      '',
    ].join('\n'), 'utf8');
  }
  await appendFile(rawPath, markdownFor(dayEvents, importedAt), 'utf8');
}

if (unseen.length) {
  await mkdir(path.dirname(activityPath), { recursive: true });
  await appendFile(activityPath, `${unseen.map((event) => JSON.stringify({ ...event, importedAt })).join('\n')}\n`, 'utf8');
}
const importedEventIds = [...known, ...unseen.map((event) => event.id)].slice(-2000);
await atomicWrite(importStatePath, {
  version: 1,
  lastImportedAt: importedAt,
  importedEventIds,
  endpoint: 'local OANDA SSH tunnel',
});

console.log(JSON.stringify({ mode: 'write', endpoint, received: events.length, imported: unseen.length }, null, 2));
