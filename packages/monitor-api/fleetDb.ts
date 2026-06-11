import fs from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'

type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown'

type PortalMainnetChain = {
  chainId: number
  name: string
  slug: string
  parentChainId: number
  confirmPeriodBlocks: number
  rpcUrl: string
  explorerUrl: string
  ethBridge: {
    bridge: string
    rollup: string
    sequencerInbox: string
    inbox?: string | null
    outbox?: string | null
  }
  nativeToken?: string
  nativeTokenSymbol?: string | null
  nativeTokenName?: string | null
  logo?: string | null
  color?: string | null
  bridgeUiConfig: {
    assertionIntervalSeconds: number | null
    fastWithdrawalTime: number | null
  }
}

type PortalSnapshot = {
  generatedAt: string
  maxLookbackDays: number
  portalMainnetChains: PortalMainnetChain[]
  parentStartBlocks: Record<string, number>
}

type BatchSummaryRow = {
  chain_id: number
  parent_block_timestamp: number
  batch_sequence_number: string
  data_location: number
  max_block_number: string | null
}

type AssertionSummaryRow = {
  chain_id: number
  latest_created_at: number | null
  latest_confirmed_at: number | null
  latest_event_name: string | null
  created_count: string
  confirmed_count: string
}

type RetryableSummaryRow = {
  chain_id: number
  total_count: string
  expiring_count: string
  expired_count: string
}

// Highest USD value among a chain's expiring-or-expired retryables (the value
// "at risk" of manual recovery). Optional — degrades to [] when the worker's
// asset/price enrichment tables aren't present yet.
type RetryableValueRow = {
  chain_id: number
  at_risk_max_usd: string | null
}

type RpcSummaryRow = {
  chain_id: number
  total_count: string
  ok_count: string
  latency_ms: number | null
  last_checked_at: number | null
}

type ChainRuntimeRow = {
  chain_id: number
  arbos_raw: number | null
  arbos_version: number | null
  arbos_name: string | null
  batch_poster: string | null
  tps: number | null
  poster_balance_wei: string | null
  base_stake_wei: string | null
  validator_whitelist_disabled: boolean | null
  child_head_block: string | null
  daily_burn_wei: string | null
  checked_at_epoch: number | null
}

type BalanceSummaryRow = {
  chain_id: number
  asset_key: string
  balance_wei: string
  previous_balance_wei: string | null
  decimals: number | null
  block_number: string | null
  checked_at: number | null
}

type PriceRow = {
  asset_key: string
  price_usd: string
  checked_at: number | null
}

type PendingExitSummaryRow = {
  chain_id: number
  pending_count: string
  pending_value_wei: string
}

type FleetChain = {
  chainId: number
  chainName: string
  chainSlug: string
  parentChainId: number
  parentChainName: string
  type: string
  health: {
    retryable: HealthStatus
    batch: HealthStatus
    assertion: HealthStatus
  }
  assertionIntervalSeconds: number | null
  lastBatchAt: number | null
  lastBatchSequenceNumber: string | null
  latestAssertionCreatedAt: number | null
  latestAssertionConfirmedAt: number | null
  createdAssertions8d: number
  confirmedAssertions8d: number
  openRetryCount: number
  openRetryUrgentCount: number
  expiredRetryableCount: number
  retryableAtRiskUsd: number | null
  rpcScore: number | null
  rpcChecks8d: number
  rpcHistory: Array<{ pct: number | null; p50: number | null } | null> | null
  lastRpcCheckedAt: number | null
  latencyMs: number | null
  raasProvider: string | null
  rpcHost: string | null
  logoUrl: string | null
  brandColor: string | null
  nativeAssetKey: string | null
  gasTokenSymbol: string | null
  gasTokenAddress: string | null
  nativeBalanceWei: string | null
  nativeAssetDecimals: number
  nativeAmount: number | null
  balanceBlockNumber: string | null
  balanceCheckedAt: number | null
  priceUsd: number | null
  priceAsset: string | null
  priceSource: string | null
  priceCheckedAt: number | null
  bridgedTvlUsd: number | null
  bridgedAmount24hUsd: number | null
  pendingOutUsd: number | null
  pendingOutNative: number | null
  pendingOutCount: number
  arbosVersion: number | null
  arbosName: string | null
  arbosRaw: number | null
  batchPoster: string | null
  posterBalanceWei: string | null
  baseStakeWei: string | null
  validatorWhitelistDisabled: boolean | null
  runwayDays: number | null
  tps: number | null
  blockBacklog: number | null
  runtimeCheckedAt: number | null
  alerts: number
}

// Gas-token / bridge-TVL prices come from DefiLlama's coins API (see
// monitor-metrics). The `coingecko:<id>` strings used as price keys are
// DefiLlama's own coin identifiers, not a CoinGecko API call.
const PRICE_SOURCE = 'defillama'
// number of bars the inspector's RPC uptime strip is bucketed into
const RPC_HISTORY_BUCKETS = 40
// number of bars in the compact table sparkline (preview of the inspector strip)
const RPC_PREVIEW_BUCKETS = 12

type RpcHistoryRow = {
  chain_id: number
  bucket: number
  total: number
  ok: number
  p50: number | null
}

// RaaS / infra provider inferred from the chain's public RPC host. Best-effort:
// many chains use vanity domains and can't be attributed (→ null).
const RAAS_BY_DOMAIN: Array<[string, string]> = [
  ['alchemy.com', 'Alchemy'],
  ['calderachain.xyz', 'Caldera'],
  ['caldera.xyz', 'Caldera'],
  ['caldera.dev', 'Caldera'],
  ['conduit.xyz', 'Conduit'],
  ['conduit-', 'Conduit'],
  ['gelato.cloud', 'Gelato'],
  ['gelato.digital', 'Gelato'],
  ['alt.technology', 'AltLayer'],
  ['altlayer', 'AltLayer'],
  ['quiknode.pro', 'QuickNode'],
  ['quicknode', 'QuickNode'],
  ['infura.io', 'Infura'],
  ['ankr.com', 'Ankr'],
  ['zeeve', 'Zeeve'],
]

const hostOf = (url?: string) => {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

const inferRaasProvider = (rpcUrl?: string) => {
  const host = hostOf(rpcUrl)
  if (!host) return null
  for (const [needle, name] of RAAS_BY_DOMAIN) {
    if (host.includes(needle)) return name
  }
  return null
}

const parentChainNames: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum One',
}

const getPortalSnapshotPath = () =>
  path.resolve(
    __dirname,
    '../../monitor-indexer/src/generated/portalMainnet.json'
  )

// inbox/outbox + gas-token fields, kept separate from portalMainnet.json so the
// indexer's Ponder build id stays stable. Merged into chains at load time.
const getPortalExtraPath = () =>
  path.resolve(
    __dirname,
    '../../monitor-indexer/src/generated/portalMainnetExtra.json'
  )

const normalizeSchemaName = (value: string | undefined) => {
  const schema = (value || 'public').trim() || 'public'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid database schema "${value}"`)
  }

  return schema
}

const tableName = (schemaName: string, table: string) => `"${schemaName}"."${table}"`

const formatTypeLabel = ({
  latestEventName,
  dataLocation,
}: {
  latestEventName: string | null
  dataLocation: number | null
}) => {
  const transport =
    dataLocation === null ? 'Unknown' : dataLocation === 0 ? 'Rollup' : 'AnyTrust'
  const protocol =
    latestEventName === null
      ? 'Unknown'
      : latestEventName.startsWith('Assertion')
        ? 'BoLD'
        : 'Classic'

  return `${transport} · ${protocol}`
}

const getBatchStatus = ({
  nowSeconds,
  lastBatchAt,
  assertionIntervalSeconds,
}: {
  nowSeconds: number
  lastBatchAt: number | null
  assertionIntervalSeconds: number | null
}): HealthStatus => {
  if (!lastBatchAt) {
    return 'critical'
  }

  const ageSeconds = nowSeconds - lastBatchAt
  const target = Math.max(
    15 * 60,
    Math.min(assertionIntervalSeconds ?? 3600, 4 * 60 * 60)
  )

  if (ageSeconds > target * 4) return 'critical'
  if (ageSeconds > target * 2) return 'warning'
  return 'healthy'
}

const getAssertionStatus = ({
  nowSeconds,
  latestCreatedAt,
  latestConfirmedAt,
  assertionIntervalSeconds,
}: {
  nowSeconds: number
  latestCreatedAt: number | null
  latestConfirmedAt: number | null
  assertionIntervalSeconds: number | null
}): HealthStatus => {
  if (!latestCreatedAt) {
    return 'critical'
  }

  const target = Math.max(assertionIntervalSeconds ?? 3600, 30 * 60)
  const createdAgeSeconds = nowSeconds - latestCreatedAt

  if (createdAgeSeconds > target * 4) return 'critical'
  if (createdAgeSeconds > target * 2) return 'warning'
  if (!latestConfirmedAt) return 'warning'
  return 'healthy'
}

const getRetryableStatus = ({
  totalCount,
  expiringCount,
  expiredCount,
}: {
  totalCount: number
  expiringCount: number
  expiredCount: number
}): HealthStatus => {
  if (expiredCount > 0) return 'critical'
  if (expiringCount > 0 || totalCount > 0) return 'warning'
  return 'healthy'
}

const countAlerts = (...statuses: string[]) =>
  statuses.reduce((count, status) => (status === 'healthy' ? count : count + 1), 0)

const parseCount = (value: string | number | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value)

// decimals defaults to 18: ETH and L2 native callvalue are 18-decimal. Custom
// gas tokens (parent-chain ERC-20s) can differ, so the bridge-balance call
// passes the token's actual decimals.
const toUsd = (
  valueWei: string | null | undefined,
  priceUsd: number | null,
  decimals = 18
) => {
  if (!valueWei || priceUsd === null) {
    return null
  }

  return (Number(valueWei) / 10 ** decimals) * priceUsd
}

// Human-readable native amount (token units), independent of any USD price.
const toNativeAmount = (
  valueWei: string | null | undefined,
  decimals = 18
) => {
  if (!valueWei) {
    return null
  }
  return Number(valueWei) / 10 ** decimals
}

const byChainId = <T extends { chain_id: number }>(rows: T[]) =>
  new Map(rows.map(row => [Number(row.chain_id), row]))

const byAssetKey = <T extends { asset_key: string }>(rows: T[]) =>
  new Map(rows.map(row => [row.asset_key, row]))

let cachedPortalSnapshot: PortalSnapshot | null = null

const loadPortalSnapshot = () => {
  if (cachedPortalSnapshot) {
    return cachedPortalSnapshot
  }

  const snapshot = JSON.parse(
    fs.readFileSync(getPortalSnapshotPath(), 'utf8')
  ) as PortalSnapshot

  // merge the decoupled extras (inbox/outbox/gas token) if present
  let extra: Record<string, {
    inbox?: string
    outbox?: string
    nativeToken?: string
    nativeTokenSymbol?: string
    nativeTokenName?: string
    logo?: string
    color?: string
  }> = {}
  try {
    extra = JSON.parse(fs.readFileSync(getPortalExtraPath(), 'utf8'))
  } catch {
    extra = {}
  }

  snapshot.portalMainnetChains = snapshot.portalMainnetChains.map(chain => {
    const e = extra[String(chain.chainId)]
    if (!e) return chain
    return {
      ...chain,
      ethBridge: { ...chain.ethBridge, inbox: e.inbox ?? null, outbox: e.outbox ?? null },
      nativeToken: e.nativeToken,
      nativeTokenSymbol: e.nativeTokenSymbol ?? null,
      nativeTokenName: e.nativeTokenName ?? null,
      logo: e.logo ?? null,
      color: e.color ?? null,
    }
  })

  cachedPortalSnapshot = snapshot
  return cachedPortalSnapshot
}

export class FleetDb {
  private readonly pool: Pool

  private readonly batchDeliveriesTable: string
  private readonly assertionEventsTable: string
  private readonly retryableTicketsTable: string
  private readonly rpcChecksTable: string
  private readonly balanceSnapshotsTable: string
  private readonly pricesTable: string
  private readonly exitsTable: string
  private readonly workerStateTable: string
  private readonly chainRuntimeTable: string
  private readonly retryableAssetsTable: string
  private readonly retryableRedemptionsTable: string

  constructor(connectionString: string, schemaName = process.env.DATABASE_SCHEMA) {
    const schema = normalizeSchemaName(schemaName)
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 5),
    })
    this.batchDeliveriesTable = tableName(schema, 'batch_deliveries')
    this.assertionEventsTable = tableName(schema, 'assertion_events')
    this.retryableTicketsTable = tableName(schema, 'retryable_tickets')
    this.rpcChecksTable = tableName(schema, 'rpc_checks')
    this.balanceSnapshotsTable = tableName(schema, 'native_balance_snapshots')
    this.pricesTable = tableName(schema, 'asset_prices')
    this.exitsTable = tableName(schema, 'exit_messages')
    this.workerStateTable = tableName(schema, 'metric_worker_state')
    this.chainRuntimeTable = tableName(schema, 'chain_runtime')
    this.retryableAssetsTable = tableName(schema, 'retryable_assets')
    this.retryableRedemptionsTable = tableName(schema, 'retryable_redemptions')
  }

  async healthCheck() {
    await this.pool.query('select 1')
    return {
      ok: true,
      snapshotGeneratedAt: loadPortalSnapshot().generatedAt,
    }
  }

  private async queryOptional<T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) {
    try {
      return await this.pool.query<T>(text, values)
    } catch (error) {
      const code = (error as { code?: string }).code
      // Tolerate schema drift so the API never 500s when the worker is behind:
      // 42P01 = undefined table, 42703 = undefined column (e.g. a new column
      // like chain_runtime.tps before the worker that adds it has redeployed).
      if (code === '42P01' || code === '42703') {
        return { rows: [] as T[] }
      }

      throw error
    }
  }

  // Per-chain retryable counts, excluding tickets the worker has confirmed
  // REDEEMED on the child chain (status is distinct from 'redeemed' keeps
  // unchecked tickets counted, so the numbers only ever shrink as redemptions
  // are confirmed — never hide a ticket we haven't verified). Falls back to the
  // plain counts if the redemptions table isn't there yet (worker not deployed).
  private async readRetryableSummary(
    nowSeconds: number
  ): Promise<{ rows: RetryableSummaryRow[] }> {
    const redeemed = `rr.status is distinct from 'redeemed'`
    try {
      return await this.pool.query<RetryableSummaryRow>(
        `
          select
            rt.chain_id,
            count(*) filter (where ${redeemed}) as total_count,
            count(*) filter (where ${redeemed} and rt.expires_at > $1 and rt.expires_at - $1 <= 72 * 60 * 60) as expiring_count,
            count(*) filter (where ${redeemed} and rt.expires_at <= $1) as expired_count
          from ${this.retryableTicketsTable} rt
          left join ${this.retryableRedemptionsTable} rr on rr.id = rt.id
          group by rt.chain_id
        `,
        [nowSeconds]
      )
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== '42P01' && code !== '42703') throw error
      // redemptions table not present yet — count every ticket as before
      return this.pool.query<RetryableSummaryRow>(
        `
          select
            chain_id,
            count(*) as total_count,
            count(*) filter (where expires_at > $1 and expires_at - $1 <= 72 * 60 * 60) as expiring_count,
            count(*) filter (where expires_at <= $1) as expired_count
          from ${this.retryableTicketsTable}
          group by chain_id
        `,
        [nowSeconds]
      )
    }
  }

  // Recent retryable tickets joined with the worker's per-ticket asset
  // enrichment (token + amount) and the latest USD price for that asset. Falls
  // back to the plain ticket list if the enrichment table/columns aren't there
  // yet (worker not deployed), so retryables always render.
  // `mode: 'recent'` returns the 25 most-recently-created tickets (the default
  // detail list). `mode: 'expired'` returns tickets that have passed their
  // 7-day timeout (expires_at <= now), ordered by how recently they lapsed —
  // these are the OLDEST tickets, so they fall outside the recent-25 window and
  // must be queried explicitly for the alerts panel to enumerate them.
  private async readRetryables(
    chainId: number,
    mode: 'recent' | 'expired' = 'recent'
  ) {
    const isExpired = mode === 'expired'
    // clause builder: `pfx` prefixes columns ('rt.' for the enriched join, '' for the plain fallback)
    const where = (pfx: string) =>
      isExpired ? `and ${pfx}expires_at <= extract(epoch from now())` : ''
    const order = (pfx: string) =>
      isExpired
        ? `order by ${pfx}expires_at desc`
        : `order by ${pfx}parent_block_timestamp desc, ${pfx}log_index desc`
    // redeemed tickets are no longer interesting — they're confirmed safe and
    // get pruned from the DB — so drop them from both lists.
    const redeemedExclusion = `and rr.status is distinct from 'redeemed'`
    const enriched = `
      select
        rt.*,
        ra.kind as asset_kind,
        ra.token_address as asset_token,
        ra.token_symbol as asset_symbol,
        ra.token_decimals as asset_decimals,
        ra.amount_wei::text as asset_amount_wei,
        p.price_usd as asset_price_usd,
        rr.status as redemption_status
      from ${this.retryableTicketsTable} rt
      left join ${this.retryableAssetsTable} ra on ra.id = rt.id
      left join ${this.retryableRedemptionsTable} rr on rr.id = rt.id
      left join lateral (
        select price_usd
        from ${this.pricesTable} ap
        where ap.asset_key = case when ra.kind = 'eth' then 'ethereum' else ra.token_address end
        order by checked_at desc
        limit 1
      ) p on true
      where rt.chain_id = $1 ${where('rt.')} ${redeemedExclusion}
      ${order('rt.')}
      limit 25
    `
    try {
      return await this.pool.query(enriched, [chainId])
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== '42P01' && code !== '42703') throw error
      // enrichment not available yet — return tickets without asset columns
      return this.pool.query(
        `
          select *
          from ${this.retryableTicketsTable}
          where chain_id = $1 ${where('')}
          ${order('')}
          limit 25
        `,
        [chainId]
      )
    }
  }

  async readFleetOverview() {
    const chains = await this.readFleetChains()

    const lastRpcCheckAt = chains.reduce<number | null>(
      (max, chain) =>
        chain.lastRpcCheckedAt != null && (max === null || chain.lastRpcCheckedAt > max)
          ? chain.lastRpcCheckedAt
          : max,
      null
    )

    return {
      generatedAt: loadPortalSnapshot().generatedAt,
      lastRpcCheckAt,
      chains: chains.length,
      statuses: {
        healthy: chains.filter(chain => chain.alerts === 0).length,
        warning: chains.filter(chain => chain.alerts > 0 && chain.alerts < 3).length,
        critical: chains.filter(chain => chain.alerts >= 3).length,
      },
      retryablesOpen: chains.reduce((sum, chain) => sum + chain.openRetryCount, 0),
      retryablesUrgent: chains.reduce(
        (sum, chain) => sum + chain.openRetryUrgentCount,
        0
      ),
      alerts: chains.reduce((sum, chain) => sum + chain.alerts, 0),
      totalTvlUsd: chains.reduce((sum, chain) => sum + (chain.bridgedTvlUsd || 0), 0),
      totalPendingOutUsd: chains.reduce(
        (sum, chain) => sum + (chain.pendingOutUsd || 0),
        0
      ),
      totalBridgedAmount24hUsd: chains.reduce(
        (sum, chain) => sum + (chain.bridgedAmount24hUsd || 0),
        0
      ),
    }
  }

  async readFleetChains(): Promise<FleetChain[]> {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const [batchRows, assertionRows, retryableRows, retryableValueRows, rpcRows, balanceRows, priceRows, exitRows, runtimeRows, rpcHistRows] =
      await Promise.all([
        this.pool.query<BatchSummaryRow>(`
          select distinct on (chain_id)
            chain_id,
            parent_block_timestamp,
            batch_sequence_number,
            data_location,
            max_block_number::text as max_block_number
          from ${this.batchDeliveriesTable}
          order by chain_id, parent_block_timestamp desc, log_index desc
        `),
        this.pool.query<AssertionSummaryRow>(`
          with latest as (
            select distinct on (chain_id)
              chain_id,
              event_name
            from ${this.assertionEventsTable}
            order by chain_id, parent_block_timestamp desc, log_index desc
          )
          select
            events.chain_id,
            max(case when events.kind = 'created' then events.parent_block_timestamp end) as latest_created_at,
            max(case when events.kind = 'confirmed' then events.parent_block_timestamp end) as latest_confirmed_at,
            latest.event_name as latest_event_name,
            count(*) filter (where events.kind = 'created') as created_count,
            count(*) filter (where events.kind = 'confirmed') as confirmed_count
          from ${this.assertionEventsTable} events
          left join latest on latest.chain_id = events.chain_id
          group by events.chain_id, latest.event_name
        `),
        this.readRetryableSummary(nowSeconds),
        // Highest USD value among each chain's expiring-or-expired retryables
        // (expires_at within the next 72h or already past). Joins the worker's
        // per-ticket asset enrichment to the latest price; only priced tickets
        // contribute. Optional so a missing enrichment table can't break the list.
        this.queryOptional<RetryableValueRow>(
          `
            select
              rt.chain_id,
              max(
                (ra.amount_wei::numeric / power(10, coalesce(ra.token_decimals, 18))) * p.price_usd
              ) as at_risk_max_usd
            from ${this.retryableTicketsTable} rt
            join ${this.retryableAssetsTable} ra on ra.id = rt.id
            left join ${this.retryableRedemptionsTable} rr on rr.id = rt.id
            join lateral (
              select price_usd
              from ${this.pricesTable} ap
              where ap.asset_key = case when ra.kind = 'eth' then 'ethereum' else ra.token_address end
              order by checked_at desc
              limit 1
            ) p on true
            where rt.expires_at <= $1 + 72 * 60 * 60
              and ra.amount_wei is not null
              and rr.status is distinct from 'redeemed'
            group by rt.chain_id
          `,
          [nowSeconds]
        ),
        this.queryOptional<RpcSummaryRow>(`
          with latest_success as (
            select distinct on (chain_id)
              chain_id,
              latency_ms
            from ${this.rpcChecksTable}
            where ok = true
              and latency_ms is not null
              and checked_at >= now() - interval '8 days'
            order by chain_id, checked_at desc, id desc
          )
          select
            checks.chain_id,
            count(*) as total_count,
            count(*) filter (where checks.ok = true) as ok_count,
            latest_success.latency_ms,
            cast(extract(epoch from max(checks.checked_at)) as bigint) as last_checked_at
          from ${this.rpcChecksTable} checks
          left join latest_success on latest_success.chain_id = checks.chain_id
          where checks.checked_at >= now() - interval '8 days'
          group by checks.chain_id, latest_success.latency_ms
        `),
        this.queryOptional<BalanceSummaryRow>(`
          with latest as (
            select distinct on (chain_id)
              chain_id,
              asset_key,
              balance_wei,
              decimals,
              block_number,
              checked_at
            from ${this.balanceSnapshotsTable}
            order by chain_id, checked_at desc, id desc
          ),
          previous as (
            select distinct on (chain_id)
              chain_id,
              balance_wei
            from ${this.balanceSnapshotsTable}
            where checked_at <= now() - interval '24 hours'
            order by chain_id, checked_at desc, id desc
          )
          select
            latest.chain_id,
            latest.asset_key,
            latest.balance_wei::text,
            latest.decimals,
            latest.block_number::text as block_number,
            cast(extract(epoch from latest.checked_at) as bigint) as checked_at,
            previous.balance_wei::text as previous_balance_wei
          from latest
          left join previous on previous.chain_id = latest.chain_id
        `),
        this.queryOptional<PriceRow>(`
          select distinct on (asset_key)
            asset_key,
            price_usd::text,
            cast(extract(epoch from checked_at) as bigint) as checked_at
          from ${this.pricesTable}
          order by asset_key, checked_at desc, id desc
        `),
        this.queryOptional<PendingExitSummaryRow>(`
          select
            chain_id,
            count(*) as pending_count,
            coalesce(sum(value_wei), 0)::text as pending_value_wei
          from ${this.exitsTable}
          where executed_at is null
          group by chain_id
        `),
        // select * so the API never hard-depends on a specific column existing
        // — a newer column (e.g. tps) missing because the worker hasn't
        // redeployed must NOT drop the columns that do exist (arbos, etc.).
        this.queryOptional<ChainRuntimeRow>(`
          select *, cast(extract(epoch from checked_at) as bigint) as checked_at_epoch
          from ${this.chainRuntimeTable}
        `),
        // coarse per-chain probe history for the table sparkline — each chain's
        // probes over its own [first probe, now] range bucketed into N bars,
        // with uptime + p50 latency per bar. A preview of the inspector chart.
        this.queryOptional<RpcHistoryRow>(`
          with windowed as (
            select
              chain_id, ok, latency_ms,
              extract(epoch from checked_at) as ts,
              min(extract(epoch from checked_at)) over (partition by chain_id) as lo
            from ${this.rpcChecksTable}
            where checked_at >= now() - interval '8 days'
          )
          select
            chain_id,
            width_bucket(ts, lo, extract(epoch from now()) + 1, ${RPC_PREVIEW_BUCKETS}) as bucket,
            count(*)::int as total,
            count(*) filter (where ok)::int as ok,
            cast(round(percentile_cont(0.5) within group (order by latency_ms)
                 filter (where ok and latency_ms is not null)) as int) as p50
          from windowed
          group by chain_id, bucket
          order by chain_id, bucket
        `),
      ])

    const batchByChainId = byChainId(batchRows.rows)
    const assertionByChainId = byChainId(assertionRows.rows)
    const retryableByChainId = byChainId(retryableRows.rows)
    const retryableValueByChainId = byChainId(retryableValueRows.rows)
    const rpcByChainId = byChainId(rpcRows.rows)
    // group the bucketed history into a fixed-length array per chain
    const rpcHistByChainId = new Map<number, Array<{ pct: number | null; p50: number | null } | null>>()
    for (const row of rpcHistRows.rows) {
      const cid = Number(row.chain_id)
      let arr = rpcHistByChainId.get(cid)
      if (!arr) {
        arr = Array(RPC_PREVIEW_BUCKETS).fill(null)
        rpcHistByChainId.set(cid, arr)
      }
      const idx = Math.max(0, Math.min(RPC_PREVIEW_BUCKETS - 1, Number(row.bucket) - 1))
      const total = Number(row.total) || 0
      arr[idx] = {
        pct: total ? (Number(row.ok) / total) * 100 : null,
        p50: row.p50 != null ? Number(row.p50) : null,
      }
    }
    const balanceByChainId = byChainId(balanceRows.rows)
    const exitByChainId = byChainId(exitRows.rows)
    const runtimeByChainId = byChainId(runtimeRows.rows)
    const priceByAssetKey = byAssetKey(priceRows.rows)

    return loadPortalSnapshot().portalMainnetChains
      .map(chain => {
        const batch = batchByChainId.get(chain.chainId)
        const assertion = assertionByChainId.get(chain.chainId)
        const retryable = retryableByChainId.get(chain.chainId)
        const retryableValue = retryableValueByChainId.get(chain.chainId)
        const rpc = rpcByChainId.get(chain.chainId)
        const balance = balanceByChainId.get(chain.chainId)
        const exit = exitByChainId.get(chain.chainId)
        const runtime = runtimeByChainId.get(chain.chainId)
        const priceRow = balance ? priceByAssetKey.get(balance.asset_key) : undefined
        const priceUsd = priceRow ? Number(priceRow.price_usd) : NaN
        const resolvedPriceUsd = Number.isFinite(priceUsd) ? priceUsd : null

        const batchStatus = getBatchStatus({
          nowSeconds,
          lastBatchAt: batch?.parent_block_timestamp ?? null,
          assertionIntervalSeconds: chain.bridgeUiConfig.assertionIntervalSeconds,
        })
        const assertionStatus = getAssertionStatus({
          nowSeconds,
          latestCreatedAt: assertion?.latest_created_at ?? null,
          latestConfirmedAt: assertion?.latest_confirmed_at ?? null,
          assertionIntervalSeconds: chain.bridgeUiConfig.assertionIntervalSeconds,
        })
        const retryableStatus = getRetryableStatus({
          totalCount: parseCount(retryable?.total_count),
          expiringCount: parseCount(retryable?.expiring_count),
          expiredCount: parseCount(retryable?.expired_count),
        })

        const rpcChecks8d = parseCount(rpc?.total_count)
        const okRpcChecks8d = parseCount(rpc?.ok_count)
        const balanceDecimals = balance?.decimals ?? 18
        const bridgedTvlUsd = toUsd(balance?.balance_wei, resolvedPriceUsd, balanceDecimals)
        const bridgedAmount24hUsd =
          bridgedTvlUsd === null
            ? null
            : bridgedTvlUsd -
              (toUsd(balance?.previous_balance_wei, resolvedPriceUsd, balanceDecimals) || 0)

        return {
          chainId: chain.chainId,
          chainName: chain.name,
          chainSlug: chain.slug,
          parentChainId: chain.parentChainId,
          parentChainName:
            parentChainNames[chain.parentChainId] ?? `Chain ${chain.parentChainId}`,
          type: formatTypeLabel({
            latestEventName: assertion?.latest_event_name ?? null,
            dataLocation: batch?.data_location ?? null,
          }),
          health: {
            retryable: retryableStatus,
            batch: batchStatus,
            assertion: assertionStatus,
          },
          assertionIntervalSeconds: chain.bridgeUiConfig.assertionIntervalSeconds,
          lastBatchAt: batch?.parent_block_timestamp ?? null,
          lastBatchSequenceNumber: batch?.batch_sequence_number ?? null,
          latestAssertionCreatedAt: assertion?.latest_created_at ?? null,
          latestAssertionConfirmedAt: assertion?.latest_confirmed_at ?? null,
          createdAssertions8d: parseCount(assertion?.created_count),
          confirmedAssertions8d: parseCount(assertion?.confirmed_count),
          openRetryCount: parseCount(retryable?.total_count),
          openRetryUrgentCount:
            parseCount(retryable?.expiring_count) + parseCount(retryable?.expired_count),
          expiredRetryableCount: parseCount(retryable?.expired_count),
          retryableAtRiskUsd:
            retryableValue?.at_risk_max_usd != null
              ? Number(retryableValue.at_risk_max_usd)
              : null,
          rpcScore: rpcChecks8d ? (okRpcChecks8d / rpcChecks8d) * 100 : null,
          rpcChecks8d,
          rpcHistory: rpcHistByChainId.get(chain.chainId) ?? null,
          lastRpcCheckedAt: rpc?.last_checked_at ?? null,
          latencyMs: rpc?.latency_ms ?? null,
          raasProvider: inferRaasProvider(chain.rpcUrl),
          rpcHost: hostOf(chain.rpcUrl),
          logoUrl: chain.logo ?? null,
          brandColor: chain.color ?? null,
          nativeAssetKey: balance?.asset_key ?? null,
          gasTokenSymbol: chain.nativeTokenSymbol ?? null,
          gasTokenAddress: chain.nativeToken ?? null,
          nativeBalanceWei: balance?.balance_wei ?? null,
          nativeAssetDecimals: balanceDecimals,
          nativeAmount: toNativeAmount(balance?.balance_wei, balanceDecimals),
          balanceBlockNumber: balance?.block_number ?? null,
          balanceCheckedAt: balance?.checked_at ?? null,
          priceUsd: resolvedPriceUsd,
          priceAsset: balance?.asset_key ?? null,
          priceSource: resolvedPriceUsd === null ? null : PRICE_SOURCE,
          priceCheckedAt: priceRow?.checked_at ?? null,
          bridgedTvlUsd,
          bridgedAmount24hUsd,
          pendingOutUsd: toUsd(exit?.pending_value_wei, resolvedPriceUsd),
          // L2→L1 callvalue is 18-decimal native (the chain's gas token),
          // independent of any USD price — surfaced for the native fallback.
          pendingOutNative: toNativeAmount(exit?.pending_value_wei, 18),
          pendingOutCount: parseCount(exit?.pending_count),
          arbosVersion: runtime?.arbos_version ?? null,
          arbosName: runtime?.arbos_name ?? null,
          arbosRaw: runtime?.arbos_raw ?? null,
          batchPoster: runtime?.batch_poster ?? null,
          posterBalanceWei: runtime?.poster_balance_wei ?? null,
          baseStakeWei: runtime?.base_stake_wei ?? null,
          validatorWhitelistDisabled: runtime?.validator_whitelist_disabled ?? null,
          // runway (days) = poster balance ÷ estimated daily gas burn
          runwayDays:
            runtime?.poster_balance_wei != null &&
            runtime?.daily_burn_wei != null &&
            Number(runtime.daily_burn_wei) > 0
              ? Number(runtime.poster_balance_wei) / Number(runtime.daily_burn_wei)
              : null,
          tps: runtime?.tps != null ? Number(runtime.tps) : null,
          // block backlog = child head − last L2 block reported in a batch
          blockBacklog:
            runtime?.child_head_block != null && batch?.max_block_number != null
              ? Math.max(0, Number(runtime.child_head_block) - Number(batch.max_block_number))
              : null,
          runtimeCheckedAt: runtime?.checked_at_epoch ?? null,
          alerts: countAlerts(retryableStatus, batchStatus, assertionStatus),
        }
      })
      .sort((left, right) => left.chainName.localeCompare(right.chainName))
  }

  async readFleetChainDetail(chainId: number) {
    const snapshot = loadPortalSnapshot().portalMainnetChains.find(
      chain => chain.chainId === chainId
    )
    if (!snapshot) {
      return null
    }

    const [chains, batchRows, assertionRows, retryableRows, expiredRetryableRows, rpcRows, exitRows] =
      await Promise.all([
        this.readFleetChains(),
        this.pool.query(
          `
            select *
            from ${this.batchDeliveriesTable}
            where chain_id = $1
            order by parent_block_timestamp desc, log_index desc
            limit 25
          `,
          [chainId]
        ),
        this.pool.query(
          `
            select *
            from ${this.assertionEventsTable}
            where chain_id = $1
            order by parent_block_timestamp desc, log_index desc
            limit 25
          `,
          [chainId]
        ),
        this.readRetryables(chainId),
        this.readRetryables(chainId, 'expired'),
        // RPC probe history bucketed across the FULL available window (up to the
        // 8-day prune horizon) into a fixed number of bars, so the chart spans
        // all probes in the DB regardless of probe interval — not just the last
        // N. Each bucket carries uptime, p50 latency, and its time span.
        this.queryOptional(
          `
            with samples as (
              select ok, latency_ms, extract(epoch from checked_at) as ts
              from ${this.rpcChecksTable}
              where chain_id = $1
                and checked_at >= now() - interval '8 days'
            ),
            bounds as (select min(ts) as lo, max(ts) as hi from samples)
            select
              width_bucket(s.ts, b.lo, b.hi + 0.001, ${RPC_HISTORY_BUCKETS}) as bucket,
              count(*)::int as total,
              count(*) filter (where s.ok)::int as ok_count,
              cast(min(s.ts) as bigint) as start_at,
              cast(max(s.ts) as bigint) as end_at,
              cast(round(percentile_cont(0.5) within group (order by s.latency_ms)
                   filter (where s.ok and s.latency_ms is not null)) as int) as p50_latency,
              bool_or(not s.ok) as any_failed
            from samples s cross join bounds b
            where b.lo is not null
            group by bucket
            order by bucket
          `,
          [chainId]
        ),
        this.queryOptional(
          `
            select
              position::text as position,
              value_wei::text as value_wei,
              extract(epoch from started_at) as started_at,
              started_tx_hash
            from ${this.exitsTable}
            where chain_id = $1
              and executed_at is null
            order by started_at desc, child_log_index desc
            limit 25
          `,
          [chainId]
        ),
      ])

    return {
      chain: chains.find((chain: FleetChain) => chain.chainId === chainId) ?? null,
      snapshot,
      recentBatches: batchRows.rows,
      recentAssertions: assertionRows.rows,
      recentRetryables: retryableRows.rows,
      expiredRetryables: expiredRetryableRows.rows,
      rpcBuckets: rpcRows.rows,
      pendingExits: exitRows.rows,
    }
  }

  // Pipeline health: worker heartbeat, indexer freshness, and exit backlog.
  // Indexer freshness is derived from the newest indexed parent-chain event
  // (version-independent), not Ponder's internal checkpoint tables.
  async readFleetStatus() {
    const [workerState, indexerRows, rpcFresh, balanceFresh, priceFresh] =
      await Promise.all([
        this.queryOptional<{ key: string; value: string; updated_at_epoch: number | null }>(`
          select key, value, cast(extract(epoch from updated_at) as bigint) as updated_at_epoch
          from ${this.workerStateTable}
          where key in ('worker_heartbeat', 'exit_backlog', 'parent_heads')
        `),
        this.queryOptional<{ parent_chain_id: number; parent_chain_name: string; latest: number | null; latest_block: string | null }>(`
          select
            parent_chain_id,
            parent_chain_name,
            max(parent_block_timestamp) as latest,
            max(parent_block_number)::text as latest_block
          from (
            select parent_chain_id, parent_chain_name, parent_block_timestamp, parent_block_number from ${this.batchDeliveriesTable}
            union all
            select parent_chain_id, parent_chain_name, parent_block_timestamp, parent_block_number from ${this.assertionEventsTable}
            union all
            select parent_chain_id, parent_chain_name, parent_block_timestamp, parent_block_number from ${this.retryableTicketsTable}
          ) events
          group by parent_chain_id, parent_chain_name
        `),
        this.queryOptional<{ latest: number | null }>(`select cast(extract(epoch from max(checked_at)) as bigint) as latest from ${this.rpcChecksTable}`),
        this.queryOptional<{ latest: number | null }>(`select cast(extract(epoch from max(checked_at)) as bigint) as latest from ${this.balanceSnapshotsTable}`),
        this.queryOptional<{ latest: number | null }>(`select cast(extract(epoch from max(checked_at)) as bigint) as latest from ${this.pricesTable}`),
      ])

    const nowSeconds = Math.floor(Date.now() / 1000)
    const stateByKey = new Map(workerState.rows.map(row => [row.key, row]))
    const parseJson = (raw: string | undefined) => {
      if (!raw) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }

    const heartbeat = parseJson(stateByKey.get('worker_heartbeat')?.value)
    // worker-recorded live head per parent chain: { "<id>": { block, checkedAt } }
    const parentHeads = parseJson(stateByKey.get('parent_heads')?.value) ?? {}

    return {
      generatedAt: new Date().toISOString(),
      worker: heartbeat
        ? { ...heartbeat, stateUpdatedAt: stateByKey.get('worker_heartbeat')?.updated_at_epoch ?? null }
        : null,
      indexer: {
        parents: indexerRows.rows
          .map(row => {
            const head = parentHeads[String(row.parent_chain_id)]
            const headBlock = head?.block ? Number(head.block) : null
            // latest indexed *event* block (a lower bound on the cursor — tight
            // on active parents where events are frequent)
            const indexedBlock = row.latest_block != null ? Number(row.latest_block) : null
            const behindBlocks =
              headBlock != null && indexedBlock != null
                ? Math.max(0, headBlock - indexedBlock)
                : null
            return {
              parentChainId: Number(row.parent_chain_id),
              parentChainName: row.parent_chain_name,
              latestEventAt: row.latest ?? null,
              lagSeconds: row.latest != null ? Math.max(nowSeconds - Number(row.latest), 0) : null,
              indexedBlock,
              headBlock,
              headCheckedAt: head?.checkedAt ?? null,
              behindBlocks,
            }
          })
          .sort((left, right) => left.parentChainId - right.parentChainId),
      },
      freshness: {
        rpc: rpcFresh.rows[0]?.latest ?? null,
        balance: balanceFresh.rows[0]?.latest ?? null,
        price: priceFresh.rows[0]?.latest ?? null,
      },
      exitBacklog: parseJson(stateByKey.get('exit_backlog')?.value) ?? [],
    }
  }

  async close() {
    await this.pool.end()
  }
}
