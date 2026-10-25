# Personal Assistant deploy

Everything here belongs to Personal Assistant and is versioned with it. It does not
live in the Vault data directory.

## Files

| File | Purpose |
|---|---|
| `ensure-assistant-server.sh` | Start the Next.js dashboard on port 3002 if it is not answering |
| `open-assistant-today.sh` | Open the Today view at 08:00 |
| `import-health-connect-exports.sh` | Pull Health Connect zips from Google Drive and import them |
| `check-assistant-health.sh` | Health check for this Assistant MCP server (port 8787) |
| `export-codex-visible-transcript.mjs` | Export a visible agent transcript |
| `legacy/import-chatgpt-export.mjs` | Older ChatGPT importer, kept for comparison — see below |
| `install-launchd.sh` | Render `launchd/*.template` and install the LaunchAgents |
| `launchd/*.plist.template` | Templates; `*.optional.template` needs `--with-optional` |

## Configuration

`~/.config/personal-assistant/settings.env` (override with
`PERSONAL_ASSISTANT_CONFIG_DIR`):

- `PERSONAL_ASSISTANT_PORT` (default 3002)
- `PERSONAL_ASSISTANT_LOG_DIR` (default `~/Library/Logs/personal-assistant`)
- `VAULT_MCP_URL` (default `http://127.0.0.1:8788/mcp`)
- `NODE_BIN`

## Install

```bash
./deploy/install-launchd.sh --dry-run
./deploy/install-launchd.sh
./deploy/install-launchd.sh --with-optional   # also enable the 8787 MCP service
```

`com.kirill.personal-assistant.mcp` is optional on purpose: there was no LaunchAgent
for port 8787 before, so installing this repository does not silently start a
service that was not running.

## legacy/import-chatgpt-export.mjs

Not deleted, because it is not equivalent to `personal-vault/scripts/import-openai-export.mjs`.
The legacy importer references attachments in 54 places; the Vault importer
references them once. A functional comparison is required before one is dropped.

## Boundary

Assistant health asserts Assistant tools (`capture_note`, `get_today_plan`) against
port 8787. It does not touch the Vault endpoint.
