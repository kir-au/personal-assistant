import { watch } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { refreshSourceInventory } from './sourceInventoryWorker.mjs';

const execFileAsync = promisify(execFile);
const WATCH_ROOTS = ['raw', 'structured', 'incoming'];
const IGNORED_PARTS = new Set(['.assets', 'archive', 'exports', 'indexes', 'logs', '.git', 'node_modules']);
const GLOBAL_KEY = Symbol.for('personal-assistant.source-inventory-lifecycle');

function isRelevant(relativePath) {
  if (!relativePath) return true;
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => IGNORED_PARTS.has(part) || part.endsWith('.assets'))) return false;
  if ([
    path.join('structured', 'plans', 'daily-projection.json'),
    path.join('structured', 'plans', 'planner-items.json'),
  ].includes(relativePath)) return false;
  return /\.(md|txt|json|jsonl|csv|ya?ml)$/i.test(relativePath);
}

async function readProjection(projectionPath) {
  try { return JSON.parse(await readFile(projectionPath, 'utf8')); }
  catch { return null; }
}

function createLifecycle({ root, projectRoot, debounceMs, recoveryMs }) {
  const projectionPath = path.join(root, 'structured', 'plans', 'daily-projection.json');
  const generatorPath = path.join(projectRoot, 'scripts', 'generate-daily-projection.mjs');
  let stopped = false;
  let timer;
  let recoveryTimer;
  let running = null;
  let rerunRequested = false;
  const watchers = [];

  async function processChanges(reason) {
    if (stopped) return;
    if (running) {
      rerunRequested = true;
      return running;
    }
    running = (async () => {
      do {
        rerunRequested = false;
        try {
          const result = await refreshSourceInventory(root);
          if (result.status !== 'fresh') {
            console.warn(`[source-inventory] Scan incomplete (${reason}); planner left stale.`);
            continue;
          }
          const projection = await readProjection(projectionPath);
          const date = projection?.dates?.today;
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date());
          const changed = projection?.sourceInventory?.sourceVersion !== result.inventory.sourceVersion;
          if (changed || date !== today) {
            console.info(`[source-inventory] Regeneration required: sourceChanged=${changed}, dayChanged=${date !== today}.`);
            await execFileAsync(process.execPath, [generatorPath], {
              cwd: projectRoot,
              timeout: 20_000,
              maxBuffer: 1024 * 1024,
              env: { ...process.env, PERSONAL_VAULT_ROOT: root },
            });
            console.info(`[source-inventory] Planner projection refreshed (${reason}).`);
          }
        } catch (error) {
          console.error(`[source-inventory] Background refresh failed (${reason}).`, error);
        }
      } while (rerunRequested && !stopped);
    })();
    running.finally(() => {
      running = null;
      if (rerunRequested && !stopped) schedule('coalesced follow-up');
    });
    return running;
  }

  function schedule(reason) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void processChanges(reason); }, debounceMs);
    timer.unref?.();
  }

  for (const relativeRoot of WATCH_ROOTS) {
    const directory = path.join(root, relativeRoot);
    try {
      const watcher = watch(directory, { recursive: true }, (_event, filename) => {
        const relativePath = filename ? path.join(relativeRoot, String(filename)) : '';
        if (isRelevant(relativePath)) schedule(`file change: ${relativePath || relativeRoot}`);
      });
      watcher.on('error', (error) => console.warn(`[source-inventory] Watch failed for ${relativeRoot}; periodic recovery remains active.`, error.message));
      watchers.push(watcher);
    } catch (error) {
      console.warn(`[source-inventory] Could not watch ${relativeRoot}; periodic recovery remains active.`, error instanceof Error ? error.message : error);
    }
  }

  // Startup and periodic full reconciliation recover changes missed by fs.watch.
  void access(root).then(() => schedule('startup')).catch((error) => {
    console.warn('[source-inventory] Vault root is unavailable; periodic recovery will retry.', error instanceof Error ? error.message : error);
  });
  recoveryTimer = setInterval(() => schedule('periodic recovery'), recoveryMs);
  recoveryTimer.unref?.();

  const lifecycle = {
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(recoveryTimer);
      for (const watcher of watchers) watcher.close();
      if (globalThis[GLOBAL_KEY] === lifecycle) delete globalThis[GLOBAL_KEY];
      return running || Promise.resolve();
    },
  };
  return lifecycle;
}

export function startSourceInventoryLifecycle({
  root = process.env.PERSONAL_VAULT_ROOT || path.join(process.env.HOME || '', 'personal-vault'),
  projectRoot = process.cwd(),
  debounceMs = 1200,
  recoveryMs = 5 * 60 * 1000,
} = {}) {
  const existing = globalThis[GLOBAL_KEY];
  if (existing) return existing;
  const lifecycle = createLifecycle({ root: path.resolve(root), projectRoot, debounceMs, recoveryMs });
  globalThis[GLOBAL_KEY] = lifecycle;
  return lifecycle;
}
