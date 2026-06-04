import { describe, expect, test } from 'vitest'
import { buildBatchPosterFindings, buildBatchPosterMonitorResult } from '../result'

const chainInfo = {
  name: 'Test Chain',
  chainId: 42161,
  parentChainId: 1,
  ethBridge: {
    sequencerInbox: '0x1111111111111111111111111111111111111111',
    bridge: '0x2222222222222222222222222222222222222222',
    rollup: '0x3333333333333333333333333333333333333333',
  },
} as any

describe('buildBatchPosterMonitorResult', () => {
  test('builds structured findings and raw facts', () => {
    const summary = {
      latestParentBlockNumber: 1000n,
      fromBlock: 500n,
      toBlock: 1000n,
      sequencerInboxLogCount: 2,
      batchPostingTimeBounds: 14400,
      latestChildChainBlockNumber: 900n,
      latestBatchPostedBlockNumber: 995n,
      secondsSinceLastBatchPoster: 20000n,
      lastBlockReported: 850n,
      batchPosterBacklog: 50n,
      isAnyTrust: true,
      balanceStatus: {
        batchPoster: '0x4444444444444444444444444444444444444444',
        currentBalance: 100n,
        minimumExpectedBalance: 200n,
        dailyPostingCostEstimate: 50n,
        daysLeftForCurrentBalance: 2n,
        message:
          'Low Batch poster balance (<x|x>): 0.0 ETH (Minimum expected balance: 0.0 ETH).',
      },
      anyTrustCheck: {
        alerts: [
          'AnyTrust chain [Test Chain] has fallen back to posting calldata on-chain. This indicates a potential issue with the Data Availability Committee.',
        ],
        functionSelector: '0x37501551',
        dataFirstByte: '0x00',
        transactionHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
      },
    }

    const findings = buildBatchPosterFindings({ chainInfo, summary })
    const result = buildBatchPosterMonitorResult({
      chainInfo,
      summary,
      findings,
      startedAt: 1000,
      finishedAt: 2000,
    })

    expect(findings.map(finding => finding.code)).toEqual([
      'low_batch_poster_balance',
      'batch_posting_delay_with_backlog',
      'anytrust_calldata_fallback',
    ])
    expect(result.monitor).toBe('batch-poster')
    expect(result.status).toBe('partial')
    expect(result.observations.map(observation => observation.kind)).toEqual([
      'batch-poster-config',
      'batch-poster-log-window',
      'batch-poster-balance-check',
      'batch-poster-latest-batch',
      'batch-poster-anytrust-check',
    ])
    expect(
      result.metrics.find(metric => metric.key === 'batch_poster_backlog_blocks')
        ?.value
    ).toBe(50n)
  })
})
