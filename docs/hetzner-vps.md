# Hetzner VPS Deployment

## Target shape

The VPS runs **only the backend writers**:

- `monitor-indexer` (event indexing)
- `monitor-metrics` (RPC probes, balances, price, backlog, heartbeat)

Everything read-facing is on Vercel:

- `monitor-api` runs on Vercel (stateless, reads Postgres)
- `monitor-web` runs on Vercel and points at the Vercel API
- Supabase Postgres remains the shared database

The VPS exposes no public ports — the writers only need outbound access to
Postgres and the parent-chain RPCs.

Do not run a second indexer — or a second metrics worker — against the same
`DATABASE_SCHEMA` at the same time.

## Server prerequisites

- Ubuntu or Debian VPS
- Node 20
- Yarn 1

Suggested install:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack disable
sudo npm install -g yarn@1.22.22
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

Fields the writers need:

- `POSTGRES_URL`
- `DATABASE_SCHEMA`
- `MONITOR_PARENT_RPC_OVERRIDES`

(The `MONITOR_API_*` / `MONITOR_WEB_API_BASE` fields are consumed by the Vercel
api/web deployment, not by the writers on this VPS.)

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
sudo cp deploy/systemd/arbitrum-monitor-metrics.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now arbitrum-monitor-indexer
sudo systemctl enable --now arbitrum-monitor-metrics
```

`enable --now` starts each service immediately and (via `WantedBy`) on every
boot. They run as detached background services — independent of your SSH session,
and `Restart=always` brings them back if they crash.

Useful commands:

```bash
sudo systemctl status arbitrum-monitor-indexer
sudo systemctl status arbitrum-monitor-metrics
sudo journalctl -u arbitrum-monitor-indexer -f
sudo journalctl -u arbitrum-monitor-metrics -f
```

To pick up a new push:

```bash
cd /opt/arbitrum-monitoring
git pull
yarn install --frozen-lockfile
sudo systemctl restart arbitrum-monitor-indexer arbitrum-monitor-metrics
```

## API and web (Vercel)

The API and web app are deployed on Vercel against the same Supabase Postgres —
nothing API-facing runs on this VPS, so no Caddy/Nginx reverse proxy is needed
here. Verify the writers are healthy through the Vercel API, which reads what
they write:

- `https://<your-vercel-app>/api/fleet/overview`
- `https://<your-vercel-app>/api/fleet/status` (worker heartbeat, indexer freshness, backlog)

## Docker option

If you prefer containers over `systemd`, use:

- [Dockerfile](../Dockerfile)
- [docker-compose.yml](../docker-compose.yml)
- [docs/docker-vps.md](./docker-vps.md)
