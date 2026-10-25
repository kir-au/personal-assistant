#!/bin/zsh
# Render the Personal Assistant LaunchAgent templates and install them.
#
#   ./deploy/install-launchd.sh               install and (re)load
#   ./deploy/install-launchd.sh --dry-run     render to stdout only
#   ./deploy/install-launchd.sh --with-optional
#                                             also install *.optional.template
#
# Files ending in .optional.template are skipped unless --with-optional is passed,
# so installing this repo does not silently start services that were not running.
#
# Machine-specific values live in ~/.config/personal-assistant/settings.env.
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="${PERSONAL_ASSISTANT_CONFIG_DIR:-$HOME/.config/personal-assistant}"
SETTINGS="$CONFIG_DIR/settings.env"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
DRY_RUN=0
WITH_OPTIONAL=0
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=1
  [[ "$arg" == "--with-optional" ]] && WITH_OPTIONAL=1
done

[[ -f "$SETTINGS" ]] && source "$SETTINGS"
: "${PERSONAL_ASSISTANT_PORT:=3002}"
: "${PERSONAL_ASSISTANT_LOG_DIR:=$HOME/Library/Logs/personal-assistant}"
: "${VAULT_MCP_URL:=http://127.0.0.1:8788/mcp}"
: "${NODE_BIN:=$(command -v node)}"
NODE_DIR="$(dirname "$NODE_BIN")"

render() {
  python3 - "$1" \
    "__REPO_DIR__=$REPO_DIR" \
    "__LOG_DIR__=$PERSONAL_ASSISTANT_LOG_DIR" \
    "__NODE_BIN__=$NODE_BIN" \
    "__NODE_DIR__=$NODE_DIR" \
    "__PORT__=$PERSONAL_ASSISTANT_PORT" \
    "__VAULT_MCP_URL__=$VAULT_MCP_URL" <<'PY'
import sys
path, *pairs = sys.argv[1:]
text = open(path, encoding="utf-8").read()
for pair in pairs:
    key, _, value = pair.partition("=")
    text = text.replace(key, value)
sys.stdout.write(text)
PY
}

mkdir -p "$LAUNCH_AGENTS" "$PERSONAL_ASSISTANT_LOG_DIR"
rc=0

for template in "$REPO_DIR"/deploy/launchd/*.template; do
  [[ -e "$template" ]] || continue
  base="$(basename "$template")"
  if [[ "$base" == *".optional.template" && "$WITH_OPTIONAL" != "1" ]]; then
    echo "skip $base (needs --with-optional)"
    continue
  fi
  name="${base/.optional/}"
  name="${name%.template}"
  label="${name%.plist}"
  target="$LAUNCH_AGENTS/$name"
  rendered="$(render "$template")"

  if [[ "$DRY_RUN" == "1" ]]; then
    print -r -- "===== $target ====="
    print -r -- "$rendered"
    continue
  fi

  # Validate before touching the live plist: a broken render must never replace
  # an agent that is currently working.
  tmp_plist="$(mktemp -t rendered-plist)"
  print -r -- "$rendered" > "$tmp_plist"
  if ! /usr/libexec/PlistBuddy -c "Print :Label" "$tmp_plist" >/dev/null 2>&1; then
    echo "rendered plist is invalid, keeping the existing agent: $target" >&2
    rm -f "$tmp_plist"
    rc=1
    continue
  fi
  /bin/mv -f "$tmp_plist" "$target"

  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  if launchctl bootstrap "gui/$(id -u)" "$target" >/dev/null 2>&1; then
    echo "installed $label"
  else
    echo "FAILED to load $label" >&2; rc=1
  fi
done

exit $rc
