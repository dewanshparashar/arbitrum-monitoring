#!/bin/sh
set -eu

# IMPORTANT: do NOT refresh the portal snapshot on boot.
#
# The snapshot (packages/monitor-indexer/src/generated/portalMainnet.json) sets
# each chain's startBlock, which feeds ponder.config.ts and therefore Ponder's
# build ID. `refresh-portal` recomputes startBlock = head - 8 days, so running
# it on every boot changes the build ID on every restart. Ponder then sees the
# schema as "previously used by a different Ponder app" and re-indexes from
# scratch (~20h) instead of resuming from its last checkpoint.
#
# Keeping the committed snapshot stable gives a deterministic build ID, so the
# indexer resumes on every restart and only re-indexes when the snapshot is
# intentionally changed.
#
# To deliberately re-scope the indexed window, refresh explicitly and commit the
# regenerated snapshot:
#   docker compose run --rm --entrypoint sh monitor-indexer -c \
#     'yarn monitor-indexer:refresh-portal'
# (then commit packages/monitor-indexer/src/generated/portalMainnet.json)
exec yarn workspace monitor-indexer start
