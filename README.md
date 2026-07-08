# Arbitrum Monitoring

This repo now has an indexed fleet register path for Orbit mainnet chains.

## What ships here

- `packages/monitor-indexer`: a Ponder indexer that derives its chain list from the latest portal `orbitChainsData.json` snapshot and indexes an 8-day window
- `packages/monitor-metrics`: a metrics worker that probes RPC uptime/latency, snapshots bridge balances and ETH price, tracks the exit-message backlog, and writes a worker heartbeat
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

That refresh step now also inspects each rollup contract on the parent chain and records its rollup event family (`classic` vs `bold`) so the indexer can register the right assertion ABI.

Start the indexer against Postgres:

```bash
export POSTGRES_URL=postgres://...
export DATABASE_SCHEMA=public
yarn workspace monitor-indexer start
```

If `DATABASE_SCHEMA` is unset, the indexer defaults to `public`. Set it explicitly if you want the API and indexer pointed at a different shared schema.

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
- `DATABASE_SCHEMA` (optional, defaults to `public`)
- `MONITOR_PARENT_RPC_OVERRIDES`
- `MONITOR_API_HOST`
- `MONITOR_API_PORT`
- `MONITOR_API_CORS_ORIGIN`
- `MONITOR_WEB_API_BASE`

The portal refresh script currently uses public RPC defaults for parent chains and can be overridden in code if we want to move those into env vars next.

## Runtime model

- `monitor-indexer` and `monitor-metrics` are the long-running **writers**: they talk to parent-chain RPCs and write rows into Postgres / Supabase Postgres. These run on the VPS (docker or systemd).
- `monitor-api` reads those indexed tables and serves JSON to the frontend. It is **stateless and runs on Vercel**.
- `monitor-web` is static, never populates the database itself, and **runs on Vercel**.
- So the split is: VPS = writers (indexer + metrics worker); Vercel = read-only API + web, both against the same Supabase Postgres.

## Product notes

- The fleet table is intentionally driven from indexed reads only. It does not fetch chain state on page load.
- The indexer now generates rollup event profiles during the portal refresh pass. If a chain profile is missing or unknown, the indexer registers both classic and BoLD assertion sources as a fallback instead of crashing.
- `R/B/A` are derived from the existing retryable, batch poster, and assertion monitoring logic, but reduced into a simple fleet register view.
- `RPC Uptime`, `Latency`, `Bridged TVL`, and `Pending Out` are scaffolded in the UI and called out in the design note below because they need separate indexed datasets.

See [docs/fleet-register.md](./docs/fleet-register.md) for the current model and the next indexing passes.

## VPS deploy

The hosted shape is:

- **VPS (docker or systemd)** runs the writers: `monitor-indexer` + `monitor-metrics`
- **Vercel** runs the read-only `monitor-api` and the static `monitor-web`, both against the same Supabase Postgres

On the VPS, `docker compose up -d --build` runs both writers detached (survives
SSH logout and reboots via `restart: unless-stopped`). To update: `git pull`
then re-run the same command.

Deployment assets for a Hetzner VPS live in:

- [docs/hetzner-vps.md](./docs/hetzner-vps.md)
- [docs/docker-vps.md](./docs/docker-vps.md)
- [deploy/hetzner/monitoring.env.example](./deploy/hetzner/monitoring.env.example)
- [deploy/systemd/arbitrum-monitor-indexer.service](./deploy/systemd/arbitrum-monitor-indexer.service)
- [deploy/systemd/arbitrum-monitor-metrics.service](./deploy/systemd/arbitrum-monitor-metrics.service)
- [Dockerfile](./Dockerfile)
- [docker-compose.yml](./docker-compose.yml)

The Vercel side reads these env vars (`POSTGRES_URL`, `DATABASE_SCHEMA`,
`MONITOR_API_CORS_ORIGIN`, `MONITOR_WEB_API_BASE`); the [Caddyfile](./deploy/caddy/monitor-api.Caddyfile)
is only needed if you instead choose to self-host the API behind a reverse proxy.
