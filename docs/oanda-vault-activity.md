# OANDA Trading activity in Personal Vault

The Trading screen reads two deliberately separate sources:

1. Live OANDA account state from `http://127.0.0.1:3319/api/status`, available only through the local SSH tunnel.
2. Append-only Vault activity imported from `structured/trading/oanda/activity.jsonl`.

The dashboard is read-only. It has no OANDA credential and no route for
creating, replacing, or closing an order.

## Daily import

Run manually when needed:

```bash
npm run import:oanda-activity -- --dry-run
npm run import:oanda-activity -- --write
```

The import is idempotent: it stores event IDs under
`structured/trading/oanda/import-state.json` and appends only unseen events.
It produces a readable daily source record at:

```text
raw/YYYY/MM/YYYY-MM-DD-oanda-au200-activity.md
```

The existing Personal Vault daily reviewer runs this read-only import each
morning. If the SSH tunnel is unavailable, the importer fails without changing
the prior OANDA Vault records. A failed import must be reported, not replaced
with an inferred account state.
