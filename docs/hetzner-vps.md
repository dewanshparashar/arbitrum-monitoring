# Hetzner VPS Deployment

## Target shape

- `monitor-indexer` runs as the only writer
- `monitor-api` runs on the same VPS
- Supabase Postgres remains the database
- `monitor-web` can stay on Vercel and point at the VPS API

Do not run a second indexer against the same `DATABASE_SCHEMA` at the same time.

## Server prerequisites

- Ubuntu or Debian VPS
- Node 20
- Yarn 1
- Caddy or Nginx

Suggested install:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack disable
sudo npm install -g yarn@1.22.22
sudo apt-get install -y caddy
```

## App setup

```bash
sudo mkdir -p /opt/arbitrum-monitoring
sudo chown "$USER":"$USER" /opt/arbitrum-monitoring
git clone https://github.com/dewanshparashar/arbitrum-monitoring.git /opt/arbitrum-monitoring
cd /opt/arbitrum-monitoring
git checkout dewansh/fleet-register-main
yarn install
```

## Environment

Create `/etc/arbitrum-monitoring/monitoring.env` from [deploy/hetzner/monitoring.env.example](../deploy/hetzner/monitoring.env.example).

Important fields:

- `POSTGRES_URL`
- `DATABASE_SCHEMA`
- `MONITOR_PARENT_RPC_OVERRIDES`
- `MONITOR_API_HOST=127.0.0.1`
- `MONITOR_API_PORT=4010`
- `MONITOR_API_CORS_ORIGIN`
- `MONITOR_WEB_API_BASE`

Use dedicated RPCs at minimum for parent chain `42161`. The indexer can resume on the VPS if you reuse the same `POSTGRES_URL` and `DATABASE_SCHEMA` that were already indexing elsewhere, but stop the old indexer first.

## Snapshot refresh

Run this once on the VPS before starting the indexer:

```bash
cd /opt/arbitrum-monitoring
set -a
source /etc/arbitrum-monitoring/monitoring.env
set +a
yarn monitor-indexer:refresh-portal
```

## systemd

Copy the service units:

```bash
sudo mkdir -p /etc/arbitrum-monitoring
sudo cp deploy/systemd/arbitrum-monitor-indexer.service /etc/systemd/system/
sudo cp deploy/systemd/arbitrum-monitor-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now arbitrum-monitor-indexer
sudo systemctl enable --now arbitrum-monitor-api
```

Useful commands:

```bash
sudo systemctl status arbitrum-monitor-indexer
sudo systemctl status arbitrum-monitor-api
sudo journalctl -u arbitrum-monitor-indexer -f
sudo journalctl -u arbitrum-monitor-api -f
```

## Caddy

Copy [deploy/caddy/monitor-api.Caddyfile](../deploy/caddy/monitor-api.Caddyfile) into `/etc/caddy/Caddyfile`, replace the hostname, then reload:

```bash
sudo systemctl reload caddy
```

The API should be reachable at:

- `/health`
- `/api/fleet/overview`
- `/api/fleet/chains`

## Web app

If the web app stays on Vercel, set its API base to the VPS API origin, for example:

```text
https://monitor.your-domain.example
```

If you also want to move the static web app to the VPS later, it can be served separately, but the critical move is the indexer and API.

## Docker option

If you prefer containers over `systemd`, use:

- [Dockerfile](../Dockerfile)
- [docker-compose.yml](../docker-compose.yml)
- [docs/docker-vps.md](./docker-vps.md)
