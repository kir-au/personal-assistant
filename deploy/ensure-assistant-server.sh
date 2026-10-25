#!/bin/zsh
# Ensure the Personal Assistant web server is responding; start it if not.
# Owner: Personal Assistant. Renamed from ensure-personal-dashboard-server.sh.
set -euo pipefail

CONFIG_DIR="${PERSONAL_ASSISTANT_CONFIG_DIR:-$HOME/.config/personal-assistant}"
[[ -f "$CONFIG_DIR/settings.env" ]] && source "$CONFIG_DIR/settings.env"

PROJECT_DIR="${PERSONAL_ASSISTANT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
PORT="${PERSONAL_ASSISTANT_PORT:-3002}"
URL="http://localhost:${PORT}/?view=today"
LOG_DIR="${PERSONAL_ASSISTANT_LOG_DIR:-$HOME/Library/Logs/personal-assistant}"
PID_FILE="${LOG_DIR}/personal-assistant-server.pid"

export PATH="${NODE_DIR:-/Users/kirill/.nvm/versions/node/v24.15.0/bin}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$LOG_DIR"
timestamp() { /bin/date "+%Y-%m-%dT%H:%M:%S%z"; }

if /usr/bin/curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; then
  echo "$(timestamp) personal-assistant already responding on ${URL}"
  exit 0
fi

cd "$PROJECT_DIR"
echo "$(timestamp) starting personal-assistant on port ${PORT}"
/usr/bin/nohup npm run dev -- -p "$PORT" </dev/null >> "${LOG_DIR}/personal-assistant-server.out.log" 2>> "${LOG_DIR}/personal-assistant-server.err.log" &
echo "$!" > "$PID_FILE"

sleep 8
if /usr/bin/curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then
  echo "$(timestamp) personal-assistant started on ${URL}"
  exit 0
fi
echo "$(timestamp) personal-assistant did not respond after startup attempt" >&2
exit 1
