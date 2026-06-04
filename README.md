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

1. Copy and edit the config file:

```bash
cp config.example.json config.json
```

2. Configure your chains in `config.json`:

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
- `MONITOR_CONFIG_PATH`
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
cp config.example.json config.json
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
- `MONITOR_CONFIG_PATH`
- access to `config.json`

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
