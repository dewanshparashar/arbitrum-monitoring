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
  }
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
  rpcScore: null
  latencyMs: null
  bridgedTvlUsd: null
  pendingOutUsd: null
  alerts: number
}

const parentChainNames: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum One',
}

const formatStatus = (value: HealthStatus) => value

const getPortalSnapshotPath = () =>
  path.resolve(
    __dirname,
    '../../monitor-indexer/src/generated/portalMainnet.json'
  )

let cachedPortalSnapshot: PortalSnapshot | null = null

const loadPortalSnapshot = (): PortalSnapshot => {
  if (cachedPortalSnapshot) {
    return cachedPortalSnapshot
  }

  cachedPortalSnapshot = JSON.parse(
    fs.readFileSync(getPortalSnapshotPath(), 'utf8')
  ) as PortalSnapshot
  return cachedPortalSnapshot
}

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
}) => {
  if (!lastBatchAt) {
    return formatStatus('critical')
  }

  const ageSeconds = nowSeconds - lastBatchAt
  const target = Math.max(
    15 * 60,
    Math.min(assertionIntervalSeconds ?? 3600, 4 * 60 * 60)
  )

  if (ageSeconds > target * 4) return formatStatus('critical')
  if (ageSeconds > target * 2) return formatStatus('warning')
  return formatStatus('healthy')
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
}) => {
  if (!latestCreatedAt) {
    return formatStatus('critical')
  }

  const target = Math.max(assertionIntervalSeconds ?? 3600, 30 * 60)
  const createdAgeSeconds = nowSeconds - latestCreatedAt

  if (createdAgeSeconds > target * 4) return formatStatus('critical')
  if (createdAgeSeconds > target * 2) return formatStatus('warning')
  if (!latestConfirmedAt) return formatStatus('warning')
  return formatStatus('healthy')
}

const getRetryableStatus = ({
  totalCount,
  expiringCount,
  expiredCount,
}: {
  totalCount: number
  expiringCount: number
  expiredCount: number
}) => {
  if (expiredCount > 0) return formatStatus('critical')
  if (expiringCount > 0 || totalCount > 0) return formatStatus('warning')
  return formatStatus('healthy')
}

const countAlerts = (...statuses: string[]) =>
  statuses.reduce((count, status) => (status === 'healthy' ? count : count + 1), 0)

const parseCount = (value: string | number | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value)

const byChainId = <T extends { chain_id: number }>(rows: T[]): Map<number, T> =>
  new Map(rows.map(row => [Number(row.chain_id), row]))

export class FleetDb {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString })
  }

  async healthCheck() {
    await this.pool.query('select 1')
    return {
      ok: true,
      snapshotGeneratedAt: loadPortalSnapshot().generatedAt,
    }
  }

  async readFleetOverview() {
    const chains = await this.readFleetChains()

    return {
      generatedAt: loadPortalSnapshot().generatedAt,
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
    }
  }

  async readFleetChains(): Promise<FleetChain[]> {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const [batchRows, assertionRows, retryableRows] = await Promise.all([
      this.pool.query<BatchSummaryRow>(`
        select distinct on (chain_id)
          chain_id,
          parent_block_timestamp,
          batch_sequence_number,
          data_location
        from batch_deliveries
        order by chain_id, parent_block_timestamp desc, log_index desc
      `),
      this.pool.query<AssertionSummaryRow>(`
        with latest as (
          select distinct on (chain_id)
            chain_id,
            event_name
          from assertion_events
          order by chain_id, parent_block_timestamp desc, log_index desc
        )
        select
          events.chain_id,
          max(case when events.kind = 'created' then events.parent_block_timestamp end) as latest_created_at,
          max(case when events.kind = 'confirmed' then events.parent_block_timestamp end) as latest_confirmed_at,
          latest.event_name as latest_event_name,
          count(*) filter (where events.kind = 'created') as created_count,
          count(*) filter (where events.kind = 'confirmed') as confirmed_count
        from assertion_events events
        left join latest on latest.chain_id = events.chain_id
        group by events.chain_id, latest.event_name
      `),
      this.pool.query<RetryableSummaryRow>(
        `
          select
            chain_id,
            count(*) as total_count,
            count(*) filter (where expires_at > $1 and expires_at - $1 <= 72 * 60 * 60) as expiring_count,
            count(*) filter (where expires_at <= $1) as expired_count
          from retryable_tickets
          group by chain_id
        `,
        [nowSeconds]
      ),
    ])

    const batchByChainId = byChainId<BatchSummaryRow>(batchRows.rows)
    const assertionByChainId = byChainId<AssertionSummaryRow>(assertionRows.rows)
    const retryableByChainId = byChainId<RetryableSummaryRow>(retryableRows.rows)

    return loadPortalSnapshot().portalMainnetChains
      .map(chain => {
        const batch = batchByChainId.get(chain.chainId)
        const assertion = assertionByChainId.get(chain.chainId)
        const retryable = retryableByChainId.get(chain.chainId)

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
          rpcScore: null,
          latencyMs: null,
          bridgedTvlUsd: null,
          pendingOutUsd: null,
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

    const [chains, batchRows, assertionRows, retryableRows] = await Promise.all([
      this.readFleetChains(),
      this.pool.query(
        `
          select *
          from batch_deliveries
          where chain_id = $1
          order by parent_block_timestamp desc, log_index desc
          limit 25
        `,
        [chainId]
      ),
      this.pool.query(
        `
          select *
          from assertion_events
          where chain_id = $1
          order by parent_block_timestamp desc, log_index desc
          limit 25
        `,
        [chainId]
      ),
      this.pool.query(
        `
          select *
          from retryable_tickets
          where chain_id = $1
          order by parent_block_timestamp desc, log_index desc
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
    }
  }

  async close() {
    await this.pool.end()
  }
}
