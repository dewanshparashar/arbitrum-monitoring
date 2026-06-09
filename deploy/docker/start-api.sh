#!/bin/sh
set -eu

exec node packages/monitor-api/dist/main.js
