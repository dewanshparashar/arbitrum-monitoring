# Arbitrum Monitoring

## Overview

This monitoring suite helps you track the health and performance of your Arbitrum chains through three specialized monitors:

1. [**Retryable Monitor**](./packages/retryable-monitor/README.md) - Tracks ParentChain->ChildChain message execution and retryable ticket lifecycle
2. [**Batch Poster Monitor**](./packages/batch-poster-monitor/README.md) - Monitors batch posting and data availability
3. [**Assertion Monitor**](./packages/assertion-monitor/README.md) - Monitor assertion creation and validation on Arbitrum chains

Each monitor has its own detailed documentation with technical specifics and implementation details.

## Prerequisites

- Node.js v18 or greater
- Yarn package manager
- Access to Arbitrum chain RPC endpoints
- Access to parent chain RPC endpoints
- Slack workspace for alerts (optional)

## Installation

1. Clone and install dependencies:

```bash
git clone https://github.com/OffchainLabs/arbitrum-monitoring.git
cd arbitrum-monitoring
yarn install
```

## MVP runtime

The fastest MVP path is:

- `monitor-worker` on a long-running host
- `monitor-api` as the read layer
- `monitor-web` as a minimal consumer
- Postgres as the shared database

Supabase Postgres fits the database role well. The worker should still run as a normal process, not as a serverless job.

For hosted MVP deployment:

- Vercel can host `monitor-web` and the read-only API
- Supabase Postgres can back both the API and worker
- the worker should stay off Vercel

## Configuration

### Chain Configuration

The worker now defaults to the latest portal snapshot at:

- [orbitChainsData.json](https://raw.githubusercontent.com/OffchainLabs/arbitrum-portal/refs/heads/master/packages/arb-token-bridge-ui/src/util/orbitChainsData.json)

It transforms that snapshot into the monitor config shape automatically.

Use these env vars to control it:

- `MONITOR_PORTAL_CONFIG_URL`
- `MONITOR_PORTAL_NETWORK` (`all`, `mainnet`, or `testnet`)
- `MONITOR_CHAIN_RPC_OVERRIDES` (JSON map of `chainId -> rpcUrl`)
- `MONITOR_PARENT_RPC_OVERRIDES` (JSON map of `parentChainId -> rpcUrl`)
- `MONITOR_PARENT_EXPLORER_OVERRIDES` (JSON map of `parentChainId -> explorerUrl`)

If you need to force a local file instead, set `MONITOR_CONFIG_PATH` and use:

```json
{
  "childChains": [
    {
      "name": "Your Chain Name",
      "chainId": 421614,
      "parentChainId": 11155111,
      "confirmPeriodBlocks": 45818,
      "parentRpcUrl": "https://your-parent-chain-rpc",
      "orbitRpcUrl": "https://your-chain-rpc",
      "ethBridge": {
        "bridge": "0x...",
        "inbox": "0x...",
        "outbox": "0x...",
        "rollup": "0x...",
        "sequencerInbox": "0x..."
      }
    }
  ]
}
```

### Alert Configuration

1. Copy and configure the environment file:

```bash
cp .env.sample .env
```

2. Set up Slack alerts in `.env` (optional):

```bash
NODE_ENV=CI
RETRYABLE_MONITORING_SLACK_TOKEN=your-slack-token
RETRYABLE_MONITORING_SLACK_CHANNEL=your-slack-channel
BATCH_POSTER_MONITORING_SLACK_TOKEN=your-slack-token
BATCH_POSTER_MONITORING_SLACK_CHANNEL=your-slack-channel
ASSERTION_MONITORING_SLACK_TOKEN=your-slack-token
ASSERTION_MONITORING_SLACK_CHANNEL=your-slack-channel
```

Required environment variables:

- `RETRYABLE_MONITORING_NOTION_TOKEN`: Notion API token for database integration
- `RETRYABLE_MONITORING_NOTION_DB_ID`: Notion database ID for storing retryable tickets

### Runtime environment

Copy the environment file:

```bash
cp .env.example .env
```

The main MVP runtime variables are:

- `POSTGRES_URL`
- `MONITOR_PORTAL_CONFIG_URL`
- `MONITOR_PORTAL_NETWORK`
- `MONITOR_API_PORT`
- `MONITOR_API_CORS_ORIGIN`
- `MONITOR_WORKER_POLL_INTERVAL_MS`

## Usage

All monitors support these base options:

- `--configPath`: Path to configuration file (default: "config.json")
- `--enableAlerting`: Enable Slack alerts (default: false)

### Quick Start Commands

```bash
# Monitor retryable tickets
yarn retryable-monitor [options]

# Monitor batch posting
yarn batch-poster-monitor [options]

# Monitor chain assertions
yarn assertion-monitor [options]
```

See individual monitor READMEs for specific options and features:

- [Retryable Monitor Details](./packages/retryable-monitor/README.md)
- [Batch Poster Monitor Details](./packages/batch-poster-monitor/README.md)
- [Assertion Monitor Details](./packages/assertion-monitor/README.md)

## Product services

```bash
# Worker
yarn monitor-worker --postgresUrl "$POSTGRES_URL"

# Read API
yarn monitor-api --postgresUrl "$POSTGRES_URL" --corsOrigin http://localhost:4020

# Minimal web app
yarn monitor-web
```

The web app is intentionally minimal. It reads data from the API and does not call chains directly.

## Docker Compose

For a quick local or single-host MVP bring-up:

```bash
cp .env.example .env
docker compose up --build
```

This starts:

- `monitor-worker`
- `monitor-api`
- `monitor-web`

Default local URLs:

- web: `http://localhost:4020`
- api: `http://localhost:4010`

## Vercel + Supabase

This repo includes a Vercel adapter:

- static output from `packages/monitor-web/dist`
- a single Vercel function at `api/v1.ts`
- rewrites from `/api/*` and `/health` into that function

Recommended database URLs:

- Vercel API: use the Supabase transaction pooler URL
- long-running worker: use the Supabase direct URL or session pooler URL

Vercel project settings:

- Root Directory: repository root
- Build Command: from `vercel.json`
- Output Directory: from `vercel.json`

Vercel environment variables:

- `POSTGRES_URL`
- optional `MONITOR_DB_PATH` if you want SQLite fallback in non-production environments

The worker deployment still needs:

- `POSTGRES_URL`
- portal snapshot access, or `MONITOR_CONFIG_PATH` if you want a local file override

## Hosted deployment

Use this split for the fastest hosted MVP:

- `Supabase`: Postgres
- `Vercel`: `monitor-web` + read-only API
- `Hetzner`: `monitor-worker`

### 1. Supabase

Create a Supabase project and keep these two connection strings:

- `DATABASE_URL`: transaction pooler URL for Vercel
- `DIRECT_URL`: direct or session-pooled URL for the worker

### 2. Vercel

Import the repository into Vercel.

Project settings:

- Root Directory: repository root
- Build Command: use `vercel.json`
- Output Directory: use `vercel.json`

Environment variables:

```bash
POSTGRES_URL=<Supabase DATABASE_URL>
```

After deploy, verify:

- `https://<your-vercel-app>/health`
- `https://<your-vercel-app>/api/overview`

Expected:

- `/health` returns `ok: true`
- `/api/overview` returns JSON

### 3. Hetzner worker

On the worker host, clone the repo and provide:

```bash
POSTGRES_URL=<Supabase DIRECT_URL>
```

Also provide:

- optional repo-root `config.json` only if you want a local override instead of the portal snapshot
- any optional Slack / Notion env vars you need

Then run:

```bash
yarn install
yarn monitor-worker --once --postgresUrl "$POSTGRES_URL"
```

Once the first pass succeeds, run the worker continuously:

```bash
yarn monitor-worker --postgresUrl "$POSTGRES_URL"
```

### 4. Hosted smoke test

After the worker has written data:

1. Open the Vercel app
2. Confirm `/health` returns non-zero overview counts
3. Confirm `/api/chains` returns chain entries
4. Confirm the web dashboard renders monitor rows

## Readiness checklist

Use this sequence for a local or hosted MVP verification:

1. Run one worker pass:

```bash
yarn monitor-worker --once --postgresUrl "$POSTGRES_URL"
```

2. Start the API:

```bash
yarn monitor-api --postgresUrl "$POSTGRES_URL" --corsOrigin "*"
```

3. Verify health and data:

```bash
curl http://localhost:4010/health
curl http://localhost:4010/api/overview
curl http://localhost:4010/api/chains
```

Expected checks:

- `/health` returns `ok: true`
- `/health` includes the active store and overview counts
- `/api/overview` shows non-zero snapshots after a successful worker run
- `/api/chains` returns at least one chain when snapshots exist

4. Start the minimal web app:

```bash
yarn monitor-web
```

Then open `http://localhost:4020`.

### Notion Integration

When `--writeToNotion` is enabled, the monitor will:

- Create new pages in the Notion database for each retryable ticket
- Update existing pages when ticket status changes
- Run a daily sweep to mark expired tickets
- Track ticket status, creation time, expiration time, and transaction hashes

The Notion database should have the following properties:

- Ticket ID (title)
- Status (select)
- Created At (date)
- Expires At (date)
- Transaction Hash (url)
- Last Updated (date)
