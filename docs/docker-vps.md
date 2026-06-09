# Docker VPS Deployment

## What runs

- `monitor-indexer`: long-running Ponder worker
- `monitor-api`: read-only API against the same Postgres schema
- `monitor-web`: optional local static UI on port `4020`

The web app can still stay on Vercel. The critical services are the indexer and API.

Do not run two indexers against the same `POSTGRES_URL` and `DATABASE_SCHEMA` at the same time.

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

Then edit `deploy/hetzner/monitoring.env` with your real values:

- `POSTGRES_URL`
- `DATABASE_SCHEMA`
- `MONITOR_PARENT_RPC_OVERRIDES`
- `MONITOR_API_CORS_ORIGIN`
- `MONITOR_WEB_API_BASE`

At minimum, use a dedicated RPC for parent chain `42161`.

## First run

After the env file is ready, the Docker path is just:

```bash
docker compose up -d --build
```

What happens automatically:

- the indexer container refreshes the portal snapshot on boot
- the indexer container then starts `ponder`
- the API container serves on port `4010`
- the web container serves on port `4020`
- the web container writes `MONITOR_WEB_API_BASE` into its runtime config before starting

## Useful commands

Logs:

```bash
docker compose logs -f monitor-indexer
docker compose logs -f monitor-api
docker compose logs -f monitor-web
```

Restart:

```bash
docker compose restart monitor-indexer
docker compose restart monitor-api
```

Stop:

```bash
docker compose down
```

## API endpoints

When `monitor-api` is up, it should answer on:

- `http://YOUR_HOST:4010/health`
- `http://YOUR_HOST:4010/api/fleet/overview`
- `http://YOUR_HOST:4010/api/fleet/chains`

If you put Caddy or Nginx in front, point the web app at that public API origin instead.
