#!/bin/sh
set -eu

service="${1:-monitor-api}"

if [ "$service" = "monitor-api" ]; then
  exec node /app/packages/monitor-api/dist/main.js
fi

if [ "$service" = "monitor-worker" ]; then
  exec node /app/packages/monitor-worker/dist/main.js
fi

if [ "$service" = "monitor-web" ]; then
  exec node /app/packages/monitor-web/dist/server.js
fi

echo "unknown service: $service" >&2
exit 1
