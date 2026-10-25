#!/bin/zsh
# Pull Health Connect exports from Google Drive and import them into the Vault.
# Owner: Personal Assistant (the importer is an Assistant script). It writes to the
# Vault as a consumer, through the Vault's own incoming/ area.
set -euo pipefail

CONFIG_DIR="${PERSONAL_ASSISTANT_CONFIG_DIR:-$HOME/.config/personal-assistant}"
[[ -f "$CONFIG_DIR/settings.env" ]] && source "$CONFIG_DIR/settings.env"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_DIR="${PERSONAL_VAULT_ROOT:-$HOME/personal-vault}"
NODE_BIN="${NODE_BIN:-/Users/kirill/.nvm/versions/node/v24.15.0/bin/node}"
RCLONE_BIN="${RCLONE_BIN:-/opt/homebrew/bin/rclone}"
RCLONE_CONFIG_FILE="${RCLONE_CONFIG_FILE:-$HOME/.config/rclone/rclone.conf}"
RCLONE_REMOTE="${HEALTH_CONNECT_RCLONE_REMOTE:-personal-vault-drive:Personal Vault/Imports/Health Connect}"
LOCAL_SOURCE_DIR="$VAULT_DIR/incoming/health-connect"

if [[ -n "${HEALTH_CONNECT_EXPORT_DIR:-}" ]]; then
  SOURCE_DIR="$HEALTH_CONNECT_EXPORT_DIR"
else
  [[ -x "$RCLONE_BIN" ]] || { echo "rclone is not available at $RCLONE_BIN" >&2; exit 1; }
  [[ -f "$RCLONE_CONFIG_FILE" ]] || { echo "rclone config is not available at $RCLONE_CONFIG_FILE" >&2; exit 1; }
  mkdir -p "$LOCAL_SOURCE_DIR"
  "$RCLONE_BIN" --config "$RCLONE_CONFIG_FILE" --log-level ERROR \
    copy "$RCLONE_REMOTE" "$LOCAL_SOURCE_DIR" --include '*.zip' --create-empty-src-dirs
  SOURCE_DIR="$LOCAL_SOURCE_DIR"
fi

"$NODE_BIN" "$REPO_DIR/scripts/import-health-connect-export.mjs" --vault "$VAULT_DIR" --source "$SOURCE_DIR" --write
