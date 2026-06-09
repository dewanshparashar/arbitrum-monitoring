#!/bin/sh
set -eu

yarn monitor-indexer:refresh-portal
exec yarn workspace monitor-indexer start
