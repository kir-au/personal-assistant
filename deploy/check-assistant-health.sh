#!/bin/zsh
# Health check for the Personal Assistant MCP server (port 8787) only.
#
# Split out of the old check-mcp-health.sh, which asserted Assistant-shaped tools
# (capture_note, get_today_plan) against the Vault endpoint. Vault health is
# checked separately by personal-vault/deploy/check-vault-health.sh.
#
# Reports and exits non-zero if the Assistant MCP is not answering. It does not
# silently start a server: there is no LaunchAgent for 8787 yet.
set -u

CONFIG_DIR="${PERSONAL_ASSISTANT_CONFIG_DIR:-$HOME/.config/personal-assistant}"
[[ -f "$CONFIG_DIR/settings.env" ]] && source "$CONFIG_DIR/settings.env"

LOG_DIR="${PERSONAL_ASSISTANT_LOG_DIR:-$HOME/Library/Logs/personal-assistant}"
LOG_FILE="$LOG_DIR/assistant-mcp-health.log"
MCP_URL="${ASSISTANT_MCP_URL:-http://127.0.0.1:8787/mcp}"
_TOKENS="${MCP_SERVICE_TOKENS:-}"
AUTH_ENABLED="${_TOKENS:+yes}"
AUTH_HEADER="Authorization: Bearer ${_TOKENS%%,*}"

mkdir -p "$LOG_DIR"
timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

post() {
  if [[ -n "$AUTH_ENABLED" ]]; then
    curl --http1.1 -m 10 -sS -X POST "$MCP_URL" \
      -H 'Content-Type: application/json' -H "$AUTH_HEADER" \
      -H 'Accept: application/json, text/event-stream' --data "$1" 2>&1
  else
    curl --http1.1 -m 10 -sS -X POST "$MCP_URL" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' --data "$1" 2>&1
  fi
}

init_body="$(post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"assistant-healthcheck","version":"1.0"}}}')"
ok=false

if print -r -- "$init_body" | grep -q '"serverInfo"'; then
  tools_body="$(post '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')"
  if print -r -- "$tools_body" | grep -q '"capture_note"' \
     && print -r -- "$tools_body" | grep -q '"get_today_plan"'; then
    ok=true
  fi
fi

print -r -- "$(timestamp) assistant-mcp url=$MCP_URL ok=$ok" >> "$LOG_FILE"

if [[ "$ok" != true ]]; then
  print -r -- "Assistant MCP not healthy at $MCP_URL" >&2
  print -r -- "No LaunchAgent is installed for port 8787. Start it with: npm run mcp:assistant" >&2
  exit 1
fi
print -r -- "Assistant MCP healthy at $MCP_URL"
exit 0
