import {
  DerivedFinding,
  MonitorRunResult,
  RawMetric,
  RawObservation,
} from 'monitor-core'

export type BatchPosterMonitorOptions = {
  configPath: string
  enableAlerting: boolean
  writeToNotion: boolean
}

export type BatchPosterObservationKind =
  | 'batch-poster-config'
  | 'batch-poster-log-window'
  | 'batch-poster-balance-check'
  | 'batch-poster-safe-block-window'
  | 'batch-poster-latest-batch'
  | 'batch-poster-anytrust-check'

export interface BatchPosterObservation extends RawObservation {
  monitor: 'batch-poster'
  kind: BatchPosterObservationKind
}

export type BatchPosterMetricKey =
  | 'latest_parent_block_number'
  | 'latest_child_block_number'
  | 'batch_posting_timebounds_seconds'
  | 'sequencer_inbox_log_count'
  | 'batch_poster_backlog_blocks'
  | 'seconds_since_last_batch'
  | 'last_block_reported'
  | 'latest_safe_block_number'
  | 'pending_blocks_to_post'
  | 'batch_poster_balance_wei'
  | 'minimum_expected_balance_wei'
  | 'estimated_daily_posting_cost_wei'
  | 'estimated_days_of_balance_left'
  | 'is_anytrust'

export interface BatchPosterMetric extends RawMetric {
  monitor: 'batch-poster'
  key: BatchPosterMetricKey
}

export type BatchPosterFindingCode =
  | 'low_batch_poster_balance'
  | 'no_recent_batches_with_backlog'
  | 'batch_posting_delay_with_backlog'
  | 'anytrust_calldata_fallback'
  | 'anytrust_decode_error'

export interface BatchPosterFinding extends DerivedFinding {
  monitor: 'batch-poster'
  code: BatchPosterFindingCode
}

export type BatchPosterMonitorResult = MonitorRunResult<
  BatchPosterObservation,
  BatchPosterMetric,
  BatchPosterFinding
>

export type BatchPosterBalanceStatus = {
  batchPoster: `0x${string}`
  currentBalance: bigint
  message?: string | null
  minimumExpectedBalance?: bigint
  dailyPostingCostEstimate?: bigint
  daysLeftForCurrentBalance?: bigint
}

export type AnyTrustCheckResult = {
  alerts: string[]
  functionSelector?: string
  dataFirstByte?: string
  transactionHash?: `0x${string}`
}

export type BatchPosterMonitorSummary = {
  latestParentBlockNumber: bigint
  fromBlock: bigint
  toBlock: bigint
  sequencerInboxLogCount: number
  batchPostingTimeBounds: number
  latestChildChainBlockNumber: bigint
  lastBlockReported?: bigint
  latestBatchPostedBlockNumber?: bigint
  secondsSinceLastBatchPoster?: bigint
  batchPosterBacklog?: bigint
  latestSafeBlockNumber?: bigint
  pendingBlocksToBePosted?: bigint
  pendingBlocksContainUserTransactions?: boolean
  isAnyTrust?: boolean
  balanceStatus?: BatchPosterBalanceStatus
  anyTrustCheck?: AnyTrustCheckResult
}
