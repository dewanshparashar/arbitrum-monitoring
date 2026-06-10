# Docker VPS Deployment

## What runs where

The VPS docker stack runs **only the backend writers**:

- `monitor-indexer`: long-running Ponder worker (event indexing)
- `monitor-metrics`: long-running metrics worker (RPC uptime probes, bridge
  balances, ETH price, exit-message backlog, worker heartbeat)

The **API and web app run on Vercel** (stateless, reading the same Postgres) —
they are not part of this docker stack. The VPS exposes no public ports; both
containers only need outbound access to Postgres and the parent-chain RPCs.

Do not run two indexers — or two metrics workers — against the same
`POSTGRES_URL` and `DATABASE_SCHEMA` at the same time.

## Prerequisites

- Docker
- Docker Compose plugin

## Setup

Clone the repo on the VPS:

```bash
git clone https://github.com/dewanshparashar/arbitrum-monitoring.git /opt/arbitrum-monitoring
cd /opt/arbitrum-monitoring
git checkout dewansh/fleet-register-main
```

Create the env file from the example:

```bash
cp deploy/hetzner/monitoring.env.example deploy/hetzner/monitoring.env
```

Then edit `deploy/hetzner/monitoring.env` with your real values. The writers
need:

- `POSTGRES_URL`
- `DATABASE_SCHEMA`
- `MONITOR_PARENT_RPC_OVERRIDES`

(`MONITOR_API_CORS_ORIGIN` / `MONITOR_WEB_API_BASE` are consumed by the Vercel
api/web deployment, not by these containers.)

At minimum, use a dedicated RPC for parent chain `42161`.

## First run

After the env file is ready, the Docker path is just:

```bash
docker compose up -d --build
```

`-d` runs the stack **detached** — the containers keep running after you close
your SSH session, and `restart: unless-stopped` brings them back after a crash
or VPS reboot.

What happens automatically:

- the indexer container refreshes the portal snapshot on boot, then starts `ponder`
- the metrics worker container builds and starts its cycle loop

## Updating to the latest code

To pick up a new push, pull and rebuild. `up -d --build` rebuilds the images
from the new checkout and recreates each changed container (old one stopped, new
one started — not duplicated); unchanged services are left running.

```bash
cd /opt/arbitrum-monitoring
git pull
docker compose up -d --build
```

To redeploy a single writer (e.g. only the metrics worker changed):

```bash
docker compose up -d --build monitor-metrics
```

## Useful commands

Logs:

```bash
docker compose logs -f monitor-indexer
docker compose logs -f monitor-metrics
```

Restart:

```bash
docker compose restart monitor-indexer
docker compose restart monitor-metrics
```

Stop:

```bash
docker compose down
```

## Verifying

These containers expose no HTTP endpoints. Confirm they are healthy by their
logs (above) and via the Vercel API, which reads what they write:

- `https://<your-vercel-app>/api/fleet/overview`
- `https://<your-vercel-app>/api/fleet/status` (worker heartbeat, indexer freshness, backlog)
