# Personal Assistant — Architectural Vision

Date: 23 September 2026. Status: architectural direction and implementation plan, not a claim of deployed background adaptation.

## Purpose

Keep the Assistant aligned with changing evidence in a user-owned folder without making the user maintain indexes, run an MCP server, or repeatedly explain what changed. Show current, source-linked understanding; do not turn every note or old date into an obligation.

Personal Vault owns readable files and neutral file operations. Personal Assistant owns interpretation, planning, freshness, and proposals. Original evidence remains readable without either application.

## Target flow

This is a logical flow inside the local client, not a set of new services or endpoints. Background execution and interpretation below are targets, not completed features.

```text
Local agent / editor                 Optional MCP client
        |                                  |
        | direct file access               | controlled file operations
        +------------------+---------------+
                           v
                  User-selected Vault folder
                           |
                 file changes / startup check
                           v
              Assistant change detector + cache
                           |
                 changed sources + context
                           v
                Source-linked interpretation
                           |
              +------------+-------------+
              v                          v
       Refreshed derived views    Proposed commitment changes
       Today / Planner / MCP              |
                                 explicit user approval
                                          |
                                readable plan + history
```

## Decisions and rationale

### AV-01 — Files are authoritative; inventory is disposable

Inventory records describe readable paths and content versions. They are not a new source of personal truth. A cache can be deleted and rebuilt without losing notes, decisions, or accepted commitments. This preserves portability and avoids a second hidden canonical database.

Keep source metadata separate from Assistant interpretations. A path under `raw/` does not prove human authorship, and a date in a filename does not prove when an event actually occurred. Preserve provenance and uncertainty.

### AV-02 — Support local filesystem access without mandatory MCP

Onboarding selects a Vault folder. The local client supplies scoped filesystem access; a generated instruction file may explain structure, safe writes, and provenance. `AGENTS.md` is guidance, not an OS permission grant or a security boundary. A remote model cannot access local files merely by receiving these instructions.

MCP/API is an optional controlled doorway to the same files. Protection depends on implemented validation, permissions, and approval checks; it can be bypassed if the same agent also has unrestricted direct filesystem access. Both access modes use the same Assistant discovery logic.

### AV-03 — Discovery is an internal capability, not a new public Vault endpoint

The reusable scanner is useful: it finds changes regardless of the writing client. `GET /api/source-inventory` is currently an Assistant Dashboard diagnostic route, not a Vault MCP tool. It is not required for the target workflow and must not become a prerequisite for a local user.

Retain it only as an optional diagnostic surface; in the target it reads cached status rather than making every request scan the entire Vault. Review its consumers and access controls before changing or removing it. Do not expand the public Vault API with planning-specific operations.

### AV-04 — Background work belongs to the local client's lifecycle

While the client is running, observe file changes, debounce bursts, and process them through one bounded worker. On startup and periodically while running, reconcile the folder to recover missed events. An explicit refresh uses the same pipeline. When the client is stopped, do not promise continuous processing; catch up on restart.

Do not introduce a separate daemon, cloud dependency, or installed recurring job merely to implement this flow. The exact client integration point remains to be selected before Step 5b implementation.

### AV-05 — Separate change detection, understanding, and commitment changes

A content hash answers “did these bytes change?”, not “is this task finished?”. Discovery selects candidate evidence. Interpretation produces source-linked conclusions, conflicts, or unknowns. Existing commitments change only through a reviewed, explicit approval path.

Start reconciliation with explicit metadata and evidence. Model-assisted interpretation is a later evaluated addition with bounded input, provenance, and failure handling. Missing evidence is not proof of unfinished work. File content is untrusted data, not authority to execute instructions.

### AV-06 — Freshness must be explainable and inexpensive

Use metadata checks to identify likely changes, hash candidate files, and periodically verify content to catch missed/coarse-timestamp changes. Metadata is an optimization, not proof of identity. Cache keys include the selected root and scanner/configuration version.

Distinguish last successful scan, source version, interpretation version, and published projection version. A fresh inventory does not imply fresh understanding. Publish derived output atomically; retain the last good result with an explicit stale/error state on failure. Coalesce overlapping requests and bound work. Exclude generated outputs from their own input dependencies.

## Actual implementation at this checkpoint

Source inspection, not a new runtime acceptance run:

- `lib/vaultSourceInventory.mjs` walks `raw`, `structured`, and `incoming`; reads supported text files; computes SHA-256 fingerprints; compares against supplied previous entries. It does not invoke a model.
- `app/api/source-inventory/route.ts` uses `HOME/personal-vault`, loads previous inventory from the daily projection, scans on demand, and returns JSON without saving it.
- `scripts/generate-daily-projection.mjs` directly calls the same helper and embeds inventory in the next projection. HTTP is not needed for this call.
- `app/api/planner/route.ts` still determines staleness from day and projection format version, not same-day source changes.
- No performance cache exists in the scanner. Every invocation rereads eligible content. The previous inventory is a comparison baseline, not a read cache.
- Deletions are not reported. Classification is a path heuristic. `discoveredAt` is currently reset on each scan. Generated daily projection content can enter its own scan input. The selected-folder contract is not used by the diagnostic route.

Thus the original Step 4 discovery slice can be verified while the broader adaptive workflow remains incomplete. Earlier tests/build results in the handoff are historical evidence, not validation of the proposed changes below.

### 4b and 5a implementation update — 23 September 2026

`lib/vaultSourceInventory.mjs` now resolves and validates the configured `PERSONAL_VAULT_ROOT` (defaulting only for local development), scans no symlinks, excludes `.assets`, archive/index/log/export trees and generated `daily-projection.json` and `planner-items.json`, and records first-seen, last-seen, metadata, content-verification and provenance-hint fields. It reports a removal only after complete coverage. Scanner version 3 invalidates older caches after the generated-output exclusion change. `lib/sourceInventoryWorker.mjs` stores a disposable cache outside the Vault at `~/.personal-assistant/source-inventory/` by default, keyed by canonical root and scanner version. The cache is atomically replaced only after a complete scan; it is safe to delete and is coalesced for concurrent refreshes.

`lib/projectionFreshness.mjs` compares the cached source version with the published projection. `app/api/planner/route.ts` now regenerates a same-day projection when source files changed, coalesces concurrent regeneration, and returns an explicit freshness state. A failed scan is stale/error state, never fresh. `GET /api/source-inventory` reads cached status; `POST /api/source-inventory` explicitly refreshes through the shared worker. Neither route writes Vault source files.

Temporary-fixture tests cover root traversal, symlink and self-output exclusion, edit/removal behavior, cache rebuild, metadata reuse, concurrent refresh, and same-day invalidation. TypeScript and production build passed. The attempted isolated browser runtime used a temporary Vault but could not start because the active dashboard already holds Next's per-project development lock; the active dashboard was not stopped or repointed.

### 5b implementation update — 25 September 2026

The Dashboard's Node.js server process now starts an in-process source inventory lifecycle through `instrumentation.ts`. It watches the configured Vault's `raw`, `structured`, and `incoming` trees, debounces relevant changes, performs a startup reconciliation, and repeats a reconciliation every five minutes to recover missed filesystem events. A complete changed inventory triggers regeneration of the derived daily projection. Concurrent refreshes coalesce; a change arriving during a scan requests another pass. Generated `daily-projection.json` and `planner-items.json` writes are excluded from discovery and watch triggers to avoid a self-refresh loop. No separate daemon or recurring operating-system job is installed.

Projection publication now writes a sibling temporary file then renames it into place. The Planner API supplies freshness state. An open Planner refreshes on window focus and once per minute, displaying stale/error state when the API cannot confirm current sources. The worker uses configured `PERSONAL_VAULT_ROOT`, defaulting to `~/personal-vault`; this Dashboard checkout does not yet provide a folder picker or the packaged Vault Browser's selected-root lifecycle.

**Verification — 25 September 2026:** the lifecycle fixture passed startup, external edits, a burst of file writes, periodic recovery for a root created after watcher setup, and stop/restart. It continuously parsed the projection during regeneration and observed no partial JSON. The inventory/cache/freshness fixtures and `npx tsc --noEmit` passed. In a temporary production server, deliberately making the generator unavailable produced a stale warning; restoring it and refreshing returned the Planner to fresh. `npm run build -- --webpack` succeeded in an isolated checkout. Default Turbopack could not build that `/tmp` checkout because its `node_modules` symlink pointed outside Turbopack's filesystem root; the active project checkout was not built over its running dev server.

In actual macOS Google Chrome, an isolated production server at `http://127.0.0.1:3032/?view=planner` displayed the temporary Planner and “Sources verified” timestamp. An inaccessible `raw/` directory and a failed projection regeneration each produced a visible stale warning; restoring access/the generator returned the UI to fresh. The temporary server was stopped afterward. No live Vault files or projection were read or written by this verification. The temporary build, fixture, cache and copied `.env.local` were removed after the checks; the source `.env.local` was untouched.

## Next implementation sequence

Steps **4b, 5a, and 5b are implemented and have focused fixture/build/UI evidence** recorded above. Continue with Steps 2 and 3, then 6, 7, and 8. The tested background lifecycle currently belongs to the Dashboard server process and uses `PERSONAL_VAULT_ROOT`; the packaged Vault Browser's selected-folder lifecycle remains a separate integration gap.

### 4b — Harden the discovery contract

- Use the configured, user-selected root; preserve root isolation and reject path/symlink escapes.
- Exclude generated projection/cache outputs and adjacent attachment directories from evidence inputs; retain explicit coverage reporting.
- Report removals only after sufficient successful scan coverage; an inaccessible folder is not mass deletion. Preserve first-seen time separately from last-seen/scan time.
- Label classification and event dates as provenance-aware hints, not verified facts.
- Keep the reusable function independent of HTTP and the Planner output file; define a separate disposable comparison baseline.
- Verify with temporary fixtures: selected root, direct/MCP-equivalent writes, edits, removals, partial errors, attachments, self-output exclusion, and rebuild after cache loss. No live Vault writes.

### 5a — Cache and truthful projection freshness

- Persist a rebuildable Assistant-owned inventory cache with explicit schema/root identity. Choose and document its location; it must not become required canonical storage.
- Add metadata fast paths, content verification, bounded execution, and coalesced concurrent work.
- Record relevant input versions and invalidate projections on same-day changes. Publish atomically and expose stale/error/processing status.
- If retained, make the diagnostic GET read cached status; discovery runs through the shared worker/refresh path.
- Verify unchanged inputs avoid unnecessary rereads/rebuilds, relevant edits invalidate, failed scans do not claim freshness, concurrent work cannot publish partial output, and cache loss is recoverable.
- Step 3's reviewed-summary selection is not a prerequisite: preserve the honest unavailable-summary state until it is implemented.

### 5b — Connect the background lifecycle

- Identify the existing local client entry point and document ownership before wiring it. Reuse 5a's worker for startup, debounced file events, periodic in-process recovery, and manual refresh.
- Verify changes made outside the Dashboard are discovered without calling the diagnostic endpoint; test missed events, restart, shutdown, bursts, and failures using fixtures.
- Show pending/stale/fresh state without requiring the user to visit an endpoint. This step does not select a model, install a daemon, or interpret commitments.

### Then return to the remaining checklist

Finish Step 2 (no fabricated tasks) and Step 3 (reviewed current summary), then Step 6 (one day-state contract), Step 7 (source-linked read-only reconciliation), and Step 8 (approval, history, and gap recovery). Do not publish a current-life interpretation merely because inventory is fresh.

## Acceptance and boundaries

The target is demonstrated when an external file edit is discovered in the running local client, affected views visibly become stale, derived state refreshes with provenance, and no commitment changes without approval. Restart recovers missed changes; a scan failure remains visible; the Vault stays usable without cache or MCP.

All implementation tests use a temporary Vault. Preserve unrelated edits, raw history, existing commitments, Health rules, research-only monitors, and tunnel logic. This document adds no runtime job and authorizes no live data reconciliation.

Related execution record: [eight-step handoff](../../personal-vault/docs/personal-vault-codex-handoff.md#next-agent-checklist--eight-small-implementation-steps).
