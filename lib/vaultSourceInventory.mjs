import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const SOURCE_INVENTORY_VERSION = 3;
const READABLE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.jsonl', '.csv', '.yaml', '.yml']);
const ROOTS = ['raw', 'structured', 'incoming'];
const SELF_OUTPUTS = new Set([
  'structured/plans/daily-projection.json',
  'structured/plans/planner-items.json',
]);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const inside = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);

function classify(pathHint) {
  const lower = pathHint.toLowerCase();
  if (/(?:^|[-_/.])(?:audit|appendix|retrospective)(?:[-_.\/]|$)/.test(lower)) return 'audit-appendix';
  if (lower.startsWith('raw/')) return 'human-note';
  if (lower.startsWith('structured/plans/') || lower.startsWith('structured/health/') || lower.startsWith('structured/trading/')) return 'derived-or-machine';
  if (lower.startsWith('incoming/') || lower.startsWith('structured/imports/')) return 'machine-import';
  return 'readable-record';
}

function eventDateHint(relativePath, content) {
  return content.match(/^(?:date|created):\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1]
    || relativePath.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})[-/]/)?.[1]
    || null;
}

export async function resolveVaultRoot(root) {
  const resolved = await realpath(root);
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory()) throw new Error('The selected Vault root must be an existing directory.');
  return resolved;
}

async function walk(root, relative, coverage) {
  let entries;
  try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    coverage.errors.push({ path: relative, message: error instanceof Error ? error.message : String(error) });
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) coverage.excluded.symlinks.push(child);
    else if (entry.isDirectory()) {
      if (entry.name.endsWith('.assets') || ['archive', 'exports', 'indexes', 'logs', '.git', 'node_modules'].includes(entry.name)) coverage.excluded.directories.push(child);
      else files.push(...await walk(root, child, coverage));
    } else if (entry.isFile() && READABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      if (SELF_OUTPUTS.has(child)) coverage.excluded.generated.push(child);
      else files.push(child);
    }
  }
  return files;
}

function sourceVersion(entries) {
  return sha256(entries.map((entry) => `${entry.path}:${entry.contentVersion}`).sort().join('\n'));
}

// Independent of HTTP and Planner output. Change detection supplies provenance
// hints only; it never changes a commitment.
export async function discoverVaultSourceChanges(root, {
  previousEntries = [],
  now = new Date().toISOString(),
  verifyContentAfterMs = 60 * 60 * 1000,
} = {}) {
  const vaultRoot = await resolveVaultRoot(root);
  const coverage = { complete: true, roots: ROOTS, scannedFiles: 0, contentReads: 0, metadataReused: 0, excluded: { directories: [], generated: [], symlinks: [] }, errors: [] };
  const previousByPath = new Map(previousEntries.filter((entry) => typeof entry?.path === 'string').map((entry) => [entry.path, entry]));
  const files = (await Promise.all(ROOTS.map((scanRoot) => walk(vaultRoot, scanRoot, coverage)))).flat().sort();
  const entries = [];
  const nowMs = Date.parse(now);
  for (const relativePath of files) {
    coverage.scannedFiles += 1;
    const fullPath = path.resolve(vaultRoot, relativePath);
    if (!inside(vaultRoot, fullPath)) { coverage.errors.push({ path: relativePath, message: 'Path escaped the selected Vault root.' }); continue; }
    try {
      const metadata = await lstat(fullPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) { coverage.excluded.symlinks.push(relativePath); continue; }
      const previous = previousByPath.get(relativePath);
      const metadataMatches = previous && previous.sizeBytes === metadata.size && previous.modifiedAt === metadata.mtime.toISOString();
      const verifiedMs = Date.parse(previous?.contentVerifiedAt || '');
      const verificationDue = !Number.isFinite(verifiedMs) || nowMs - verifiedMs >= verifyContentAfterMs;
      let contentVersion = previous?.contentVersion;
      let dateHint = previous?.eventDateHint || null;
      let contentVerifiedAt = previous?.contentVerifiedAt || now;
      if (!metadataMatches || verificationDue) {
        const content = await readFile(fullPath, 'utf8');
        contentVersion = sha256(content);
        dateHint = eventDateHint(relativePath, content);
        contentVerifiedAt = now;
        coverage.contentReads += 1;
      } else coverage.metadataReused += 1;
      entries.push({ path: relativePath, kind: classify(relativePath), eventDateHint: dateHint, eventDateConfidence: dateHint ? 'filename-or-frontmatter-hint' : 'unknown', contentVersion, sizeBytes: metadata.size, modifiedAt: metadata.mtime.toISOString(), contentVerifiedAt, firstSeenAt: previous?.firstSeenAt || now, lastSeenAt: now, change: !previous ? 'added' : previous.contentVersion === contentVersion ? 'unchanged' : 'changed' });
    } catch (error) { coverage.errors.push({ path: relativePath, message: error instanceof Error ? error.message : String(error) }); }
  }
  coverage.complete = coverage.errors.length === 0;
  const currentPaths = new Set(entries.map((entry) => entry.path));
  const removals = coverage.complete ? previousEntries.filter((entry) => entry?.path && !currentPaths.has(entry.path)).map((entry) => ({ ...entry, change: 'removed', removedAt: now })) : [];
  return { schemaVersion: SOURCE_INVENTORY_VERSION, root: vaultRoot, scannedAt: now, entries, removals, changes: [...entries.filter((entry) => entry.change !== 'unchanged'), ...removals], sourceVersion: sourceVersion(entries), coverage };
}
