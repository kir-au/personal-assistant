#!/bin/zsh
# Open the Today view of the Personal Assistant dashboard in the default browser.
set -euo pipefail
CONFIG_DIR="${PERSONAL_ASSISTANT_CONFIG_DIR:-$HOME/.config/personal-assistant}"
[[ -f "$CONFIG_DIR/settings.env" ]] && source "$CONFIG_DIR/settings.env"
URL="http://localhost:${PERSONAL_ASSISTANT_PORT:-3002}/?view=today"
/usr/bin/open "$URL"
