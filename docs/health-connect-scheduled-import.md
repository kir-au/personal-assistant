# Health Connect Scheduled Import

Personal Vault can ingest Health Connect scheduled exports as readable source material. This is intentionally a two-stage flow:

1. Android exports the Health Connect archive.
2. Personal Vault parses the Health Connect SQLite database and writes raw Markdown plus readable JSON/CSV sibling assets.
3. A review decides whether any device record should affect the Health dashboard.

The importer never silently changes calories, workouts, weight, or the daily plan.

## Android Setup

Requires Android 14 or later.

1. Confirm the watch's companion app is writing data to Health Connect: open **Settings** -> **Security and privacy** -> **Privacy controls** -> **Health Connect** -> **App permissions**. Select the companion app and allow the activity, exercise, steps, heart rate, sleep, and other data types you want to import.
2. In Health Connect, open **Recent access** and confirm the companion app has written recent data. No export setting is required on the watch itself.
3. Open **Settings** and search for **Health Connect**.
4. Open **Manage data** -> **Backup and restore** -> **Scheduled export**.
5. Turn scheduled export on and select **Daily**.
6. Tap **Next**, choose Google Drive, and select `My Drive/Personal Vault/Imports/Health Connect`.
7. Keep the default `Health Connect.zip` filename and tap **Save**.

Google documents this export as a backup ZIP and does not promise an exact daily execution time. The observed archive contains `health_connect_export.db`; the importer reads it without copying the database into the Vault.

Official Android instructions: https://support.google.com/android/answer/15323271

## Mac Setup

The local importer stages Drive exports in:

`/Users/kirill/personal-vault/incoming/health-connect`

`rclone` reads `personal-vault-drive:Personal Vault/Imports/Health Connect` through the Google Drive API. The background process does not depend on the macOS Google Drive File Provider mount.

The scheduled agent is:

`com.kirill.personal-assistant.health-connect-import`

It runs at login and every 15 minutes. It copies ZIP files from Drive, then uses:

`/Users/kirill/development/personal/personal-dashboard/deploy/import-health-connect-exports.sh`

The agent and its script are versioned in this repository under `deploy/`, not in
the Vault data directory. Install it with `./deploy/install-launchd.sh`. The old
agent label `com.kirill.personal-vault.health-connect-import` was retired in
October 2026 when Assistant runtime moved out of the Vault folder.

Manual commands:

```bash
cd /Users/kirill/development/personal/personal-dashboard
npm run import:health-connect -- --dry-run
npm run import:health-connect -- --write
```

To use another source location for a manual import:

```bash
npm run import:health-connect -- --source "/path/to/Health Connect Exports" --write
```

## Vault Output

Each previously unseen ZIP content hash becomes one readable record. The hash suffix prevents a repeatedly overwritten `Health Connect.zip` from replacing an earlier import:

```text
raw/YYYY/MM/YYYY-MM-DD-health-connect-export-*.md
raw/YYYY/MM/YYYY-MM-DD-health-connect-export-*.assets/
indexes/health-connect-imports.jsonl
indexes/captures.jsonl
```

The original ZIP remains in the synced source folder. The Vault stores:

- a Markdown import record with the latest seven-day summary;
- `health-connect-daily.csv` with daily aggregates across the exported date range;
- `health-connect-summary.json` with provenance, daily aggregates, exercise sessions, and weight records.

The SQLite database is not copied into the Vault. If more than one app reports the same daily metric, the parser selects the source with the largest daily value and records that source beside the value to avoid naively adding duplicate records. Imported values remain `review_required`; the importer does not silently update the Health dashboard.
