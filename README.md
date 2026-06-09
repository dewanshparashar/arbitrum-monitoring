# Arbitrum Monitoring

This repo now has an indexed fleet register path for Orbit mainnet chains.

## What ships here

- `packages/monitor-indexer`: a Ponder indexer that derives its chain list from the latest portal `orbitChainsData.json` snapshot and indexes an 8-day window
- `packages/monitor-api`: a read-only API backed by Postgres
- `packages/monitor-web`: a static fleet register UI that only talks to the API

The original per-monitor packages are still in the repo as reference logic for the `R/B/A` decision tree, but the product path in this PR is indexer-first.

## Indexed sources

The fleet indexer currently derives all mainnet chains from the portal snapshot and indexes:

- `SequencerBatchDelivered` on each parent chain `SequencerInbox`
- assertion events on each parent chain `Rollup`
- retryable creation events on each parent chain `Bridge`

The generated portal snapshot lives at [packages/monitor-indexer/src/generated/portalMainnet.json](./packages/monitor-indexer/src/generated/portalMainnet.json).

## Local run

Install dependencies:

```bash
yarn install
```

Refresh the mainnet portal snapshot and 8-day start blocks:

```bash
yarn monitor-indexer:refresh-portal
```

Start the indexer against Postgres:

```bash
POSTGRES_URL=postgres://... yarn monitor-indexer
```

Start the API:

```bash
POSTGRES_URL=postgres://... yarn monitor-api
```

Start the web app:

```bash
yarn monitor-web
```

Default local URLs:

- web: `http://localhost:4020`
- api: `http://localhost:4010`

## Environment

The indexed product path is env-driven:

- `POSTGRES_URL`
- `MONITOR_API_HOST`
- `MONITOR_API_PORT`
- `MONITOR_API_CORS_ORIGIN`

The portal refresh script currently uses public RPC defaults for parent chains and can be overridden in code if we want to move those into env vars next.

## Product notes

- The fleet table is intentionally driven from indexed reads only. It does not fetch chain state on page load.
- `R/B/A` are derived from the existing retryable, batch poster, and assertion monitoring logic, but reduced into a simple fleet register view.
- `RPC Uptime`, `Latency`, `Bridged TVL`, and `Pending Out` are scaffolded in the UI and called out in the design note below because they need separate indexed datasets.

See [docs/fleet-register.md](./docs/fleet-register.md) for the current model and the next indexing passes.
