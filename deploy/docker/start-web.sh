#!/bin/sh
set -eu

if [ -n "${MONITOR_WEB_API_BASE:-}" ]; then
  cat > /app/packages/monitor-web/dist/config.js <<EOF
window.MONITOR_WEB_CONFIG = {
  apiBase: '${MONITOR_WEB_API_BASE}'
}
EOF
fi

exec node packages/monitor-web/dist/server.js
