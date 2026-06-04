import { formatEther } from 'viem'
import { ChildNetwork as ChainInfo } from 'utils'
import {
  BatchPosterFinding,
  BatchPosterMetric,
  BatchPosterMonitorResult,
  BatchPosterMonitorSummary,
  BatchPosterObservation,
} from './types'

const createObservationId = (
  kind: BatchPosterObservation['kind'],
  chainId: number,
  suffix: string
) => `${kind}:${chainId}:${suffix}`

const createMetric = (
  key: BatchPosterMetric['key'],
  chainId: number,
  observedAt: number,
  value: BatchPosterMetric['value'],
  unit?: string
): BatchPosterMetric => ({
  key,
  monitor: 'batch-poster',
  chainId,
  observedAt,
  value,
  unit,
})

const createFinding = ({
  code,
  chainInfo,
  severity,
  title,
  message,
}: {
  code: BatchPosterFinding['code']
  chainInfo: ChainInfo
  severity: BatchPosterFinding['severity']
  title: string
  message: string
}): BatchPosterFinding => ({
  code,
  monitor: 'batch-poster',
  chainId: chainInfo.chainId,
  severity,
  title,
  message,
})

export const buildBatchPosterFindings = ({
  chainInfo,
  summary,
}: {
  chainInfo: ChainInfo
  summary: BatchPosterMonitorSummary
}): BatchPosterFinding[] => {
  const findings: BatchPosterFinding[] = []

  if (summary.balanceStatus?.message) {
    findings.push(
      createFinding({
        code: 'low_batch_poster_balance',
        chainInfo,
        severity: 'warning',
        title: 'Low batch poster balance',
        message: summary.balanceStatus.message,
      })
    )
  }

  if (
    summary.pendingBlocksToBePosted !== undefined &&
    summary.pendingBlocksContainUserTransactions &&
    summary.latestSafeBlockNumber !== undefined &&
    summary.sequencerInboxLogCount === 0
  ) {
    findings.push(
      createFinding({
        code: 'no_recent_batches_with_backlog',
        chainInfo,
        severity: 'critical',
        title: 'No recent batches with backlog',
        message: `No batch has been posted in the last 24 hours, and last block number (${summary.latestChildChainBlockNumber}) is greater than the last safe block number (${summary.latestSafeBlockNumber}). At least 1 batch is expected to be posted every ${
          summary.batchPostingTimeBounds / 60 / 60
        } hours.`,
      })
    )
  }

  if (
    summary.batchPosterBacklog !== undefined &&
    summary.secondsSinceLastBatchPoster !== undefined &&
    summary.batchPosterBacklog > 0n &&
    summary.secondsSinceLastBatchPoster >
      BigInt(summary.batchPostingTimeBounds)
  ) {
    findings.push(
      createFinding({
        code: 'batch_posting_delay_with_backlog',
        chainInfo,
        severity: 'critical',
        title: 'Batch posting delayed with backlog',
        message: `Last batch was posted ${
          summary.secondsSinceLastBatchPoster / 60n / 60n
        } hours and ${
          (summary.secondsSinceLastBatchPoster / 60n) % 60n
        } mins ago, and there's a backlog of ${summary.batchPosterBacklog} blocks in the chain. At least 1 batch is expected to be posted every ${
          summary.batchPostingTimeBounds / 60 / 60
        } hours.`,
      })
    )
  }

  for (const alert of summary.anyTrustCheck?.alerts ?? []) {
    findings.push(
      createFinding({
        code: alert.includes('fallen back to posting calldata')
          ? 'anytrust_calldata_fallback'
          : 'anytrust_decode_error',
        chainInfo,
        severity: 'critical',
        title: alert.includes('fallen back to posting calldata')
          ? 'AnyTrust calldata fallback detected'
          : 'AnyTrust inspection failed',
        message: alert,
      })
    )
  }

  return findings
}

export const buildBatchPosterMonitorResult = ({
  chainInfo,
  summary,
  findings,
  startedAt,
  finishedAt,
}: {
  chainInfo: ChainInfo
  summary: BatchPosterMonitorSummary
  findings: BatchPosterFinding[]
  startedAt: number
  finishedAt: number
}): BatchPosterMonitorResult => {
  const observations: BatchPosterObservation[] = [
    {
      id: createObservationId(
        'batch-poster-config',
        chainInfo.chainId,
        chainInfo.ethBridge.sequencerInbox
      ),
      monitor: 'batch-poster',
      chainId: chainInfo.chainId,
      observedAt: finishedAt,
      kind: 'batch-poster-config',
      data: {
        chainName: chainInfo.name,
        parentChainId: chainInfo.parentChainId,
        sequencerInbox: chainInfo.ethBridge.sequencerInbox,
        bridgeAddress: chainInfo.ethBridge.bridge,
        rollupAddress: chainInfo.ethBridge.rollup,
      },
    },
    {
      id: createObservationId(
        'batch-poster-log-window',
        chainInfo.chainId,
        `${summary.fromBlock}-${summary.toBlock}`
      ),
      monitor: 'batch-poster',
      chainId: chainInfo.chainId,
      observedAt: finishedAt,
      kind: 'batch-poster-log-window',
      data: {
        latestParentBlockNumber: summary.latestParentBlockNumber,
        fromBlock: summary.fromBlock,
        toBlock: summary.toBlock,
        sequencerInboxLogCount: summary.sequencerInboxLogCount,
        batchPostingTimeBoundsSeconds: summary.batchPostingTimeBounds,
      },
    },
  ]

  if (summary.balanceStatus) {
    observations.push({
      id: createObservationId(
        'batch-poster-balance-check',
        chainInfo.chainId,
        summary.balanceStatus.batchPoster
      ),
      monitor: 'batch-poster',
      chainId: chainInfo.chainId,
      observedAt: finishedAt,
      kind: 'batch-poster-balance-check',
      refs: {
        transactions: [],
      },
      data: {
        batchPoster: summary.balanceStatus.batchPoster,
        currentBalanceWei: summary.balanceStatus.currentBalance,
        currentBalanceEth: formatEther(summary.balanceStatus.currentBalance),
        minimumExpectedBalanceWei:
          summary.balanceStatus.minimumExpectedBalance ?? null,
        estimatedDailyPostingCostWei:
          summary.balanceStatus.dailyPostingCostEstimate ?? null,
        estimatedDaysOfBalanceLeft:
          summary.balanceStatus.daysLeftForCurrentBalance ?? null,
      },
    })
  }

  if (summary.latestSafeBlockNumber !== undefined) {
    observations.push({
      id: createObservationId(
        'batch-poster-safe-block-window',
        chainInfo.chainId,
        String(summary.latestSafeBlockNumber)
      ),
      monitor: 'batch-poster',
      chainId: chainInfo.chainId,
      observedAt: finishedAt,
      kind: 'batch-poster-safe-block-window',
      data: {
        latestSafeBlockNumber: summary.latestSafeBlockNumber,
        latestChildChainBlockNumber: summary.latestChildChainBlockNumber,
        pendingBlocksToBePosted: summary.pendingBlocksToBePosted ?? null,
        pendingBlocksContainUserTransactions:
          summary.pendingBlocksContainUserTransactions ?? null,
      },
    })
  }

  if (summary.latestBatchPostedBlockNumber !== undefined) {
    observations.push({
      id: createObservationId(
        'batch-poster-latest-batch',
        chainInfo.chainId,
        String(summary.latestBatchPostedBlockNumber)
      ),
      monitor: 'batch-poster',
      chainId: chainInfo.chainId,
      observedAt: finishedAt,
      kind: 'batch-poster-latest-batch',
      data: {
        latestBatchPostedBlockNumber: summary.latestBatchPostedBlockNumber,
        lastBlockReported: summary.lastBlockReported ?? null,
        secondsSinceLastBatchPoster:
          summary.secondsSinceLastBatchPoster ?? null,
        batchPosterBacklog: summary.batchPosterBacklog ?? null,
      },
    })
  }

  if (summary.anyTrustCheck) {
    observations.push({
      id: createObservationId(
        'batch-poster-anytrust-check',
        chainInfo.chainId,
        summary.anyTrustCheck.transactionHash ??
          String(summary.latestParentBlockNumber)
      ),
      monitor: 'batch-poster',
      chainId: chainInfo.chainId,
      observedAt: finishedAt,
      kind: 'batch-poster-anytrust-check',
      data: {
        isAnyTrust: summary.isAnyTrust ?? null,
        functionSelector: summary.anyTrustCheck.functionSelector ?? null,
        dataFirstByte: summary.anyTrustCheck.dataFirstByte ?? null,
        alerts: summary.anyTrustCheck.alerts,
      },
      refs: summary.anyTrustCheck.transactionHash
        ? {
            transactions: [
              {
                chainId: chainInfo.parentChainId,
                hash: summary.anyTrustCheck.transactionHash,
              },
            ],
          }
        : undefined,
    })
  }

  const metrics: BatchPosterMetric[] = [
    createMetric(
      'latest_parent_block_number',
      chainInfo.chainId,
      finishedAt,
      summary.latestParentBlockNumber,
      'blocks'
    ),
    createMetric(
      'latest_child_block_number',
      chainInfo.chainId,
      finishedAt,
      summary.latestChildChainBlockNumber,
      'blocks'
    ),
    createMetric(
      'batch_posting_timebounds_seconds',
      chainInfo.chainId,
      finishedAt,
      summary.batchPostingTimeBounds,
      'seconds'
    ),
    createMetric(
      'sequencer_inbox_log_count',
      chainInfo.chainId,
      finishedAt,
      summary.sequencerInboxLogCount
    ),
    createMetric(
      'batch_poster_backlog_blocks',
      chainInfo.chainId,
      finishedAt,
      summary.batchPosterBacklog ?? null,
      'blocks'
    ),
    createMetric(
      'seconds_since_last_batch',
      chainInfo.chainId,
      finishedAt,
      summary.secondsSinceLastBatchPoster ?? null,
      'seconds'
    ),
    createMetric(
      'last_block_reported',
      chainInfo.chainId,
      finishedAt,
      summary.lastBlockReported ?? null,
      'blocks'
    ),
    createMetric(
      'latest_safe_block_number',
      chainInfo.chainId,
      finishedAt,
      summary.latestSafeBlockNumber ?? null,
      'blocks'
    ),
    createMetric(
      'pending_blocks_to_post',
      chainInfo.chainId,
      finishedAt,
      summary.pendingBlocksToBePosted ?? null,
      'blocks'
    ),
    createMetric(
      'batch_poster_balance_wei',
      chainInfo.chainId,
      finishedAt,
      summary.balanceStatus?.currentBalance ?? null,
      'wei'
    ),
    createMetric(
      'minimum_expected_balance_wei',
      chainInfo.chainId,
      finishedAt,
      summary.balanceStatus?.minimumExpectedBalance ?? null,
      'wei'
    ),
    createMetric(
      'estimated_daily_posting_cost_wei',
      chainInfo.chainId,
      finishedAt,
      summary.balanceStatus?.dailyPostingCostEstimate ?? null,
      'wei'
    ),
    createMetric(
      'estimated_days_of_balance_left',
      chainInfo.chainId,
      finishedAt,
      summary.balanceStatus?.daysLeftForCurrentBalance ?? null,
      'days'
    ),
    createMetric(
      'is_anytrust',
      chainInfo.chainId,
      finishedAt,
      summary.isAnyTrust ?? null
    ),
  ]

  return {
    monitor: 'batch-poster',
    chainId: chainInfo.chainId,
    chainName: chainInfo.name,
    startedAt,
    finishedAt,
    status: findings.length > 0 ? 'partial' : 'ok',
    observations,
    metrics,
    findings,
    meta: {
      parentChainId: chainInfo.parentChainId,
      sequencerInbox: chainInfo.ethBridge.sequencerInbox,
      bridgeAddress: chainInfo.ethBridge.bridge,
      rollupAddress: chainInfo.ethBridge.rollup,
    },
  }
}

export const formatBatchPosterMonitorResult = (
  result: BatchPosterMonitorResult
) => `[${result.chainName}]:\n• ${result.findings.map(f => f.message).join('\n• ')}`
