import { describe, expect, test } from 'vitest'
import type { Block } from 'viem'
import { buildAssertionMonitorResult } from '../result'
import type { ChainState } from '../types'

const chainInfo = {
  name: 'Test Chain',
  chainId: 42161,
  parentChainId: 1,
  confirmPeriodBlocks: 100,
  ethBridge: {
    rollup: '0x1234567890123456789012345678901234567890',
  },
} as any

const createState = (): ChainState => ({
  childCurrentBlock: {
    number: 2000n,
    timestamp: 1700000100n,
    hash: '0x1111' as `0x${string}`,
    parentHash: '0x0000' as `0x${string}`,
  } as Block,
  childLatestCreatedBlock: {
    number: 1900n,
    timestamp: 1700000000n,
    hash: '0x2222' as `0x${string}`,
    parentHash: '0x0000' as `0x${string}`,
  } as Block,
  childLatestConfirmedBlock: {
    number: 1850n,
    timestamp: 1699999900n,
    hash: '0x3333' as `0x${string}`,
    parentHash: '0x0000' as `0x${string}`,
  } as Block,
  parentCurrentBlock: {
    number: 300n,
    timestamp: 1700000100n,
    hash: '0x4444' as `0x${string}`,
    parentHash: '0x0000' as `0x${string}`,
  } as Block,
  parentBlockAtCreation: {
    number: 250n,
    timestamp: 1700000000n,
    hash: '0x5555' as `0x${string}`,
    parentHash: '0x0000' as `0x${string}`,
  } as Block,
  parentBlockAtConfirmation: {
    number: 240n,
    timestamp: 1699999900n,
    hash: '0x6666' as `0x${string}`,
    parentHash: '0x0000' as `0x${string}`,
  } as Block,
  recentCreationEvent: {
    blockNumber: 250n,
    transactionHash: '0xaaaa' as `0x${string}`,
    logIndex: 1,
    address: '0xbbbb' as `0x${string}`,
    eventName: 'AssertionCreated',
    args: {
      assertionHash: '0xcccc' as `0x${string}`,
      parentAssertionHash: '0xdddd' as `0x${string}`,
      assertion: {
        wasmModuleRoot: '0xeeee' as `0x${string}`,
        requiredStake: 1n,
        challengeManager: '0xffff' as `0x${string}`,
        confirmPeriodBlocks: 100n,
      },
    },
  } as any,
  recentConfirmationEvent: {
    blockNumber: 240n,
    transactionHash: '0x9999' as `0x${string}`,
    logIndex: 2,
    address: '0x8888' as `0x${string}`,
    eventName: 'AssertionConfirmed',
    args: {
      blockHash: '0x7777' as `0x${string}`,
    },
  } as any,
  isValidatorWhitelistDisabled: false,
  isBaseStakeBelowThreshold: false,
  searchFromBlock: 200n,
  searchToBlock: 300n,
})

describe('buildAssertionMonitorResult', () => {
  test('builds raw-data-first assertion result payloads', () => {
    const result = buildAssertionMonitorResult({
      chainInfo,
      chainState: createState(),
      isBold: true,
      findings: [
        {
          code: 'confirmation_delay_exceeded',
          monitor: 'assertion',
          chainId: chainInfo.chainId,
          severity: 'critical',
          title: 'Confirmation period exceeded',
          message: 'Confirmation period exceeded',
        },
      ],
      startedAt: 1000,
      finishedAt: 2000,
    })

    expect(result.monitor).toBe('assertion')
    expect(result.status).toBe('partial')
    expect(result.observations.map(obs => obs.kind)).toEqual([
      'assertion-rollup-config',
      'assertion-chain-state',
      'assertion-creation-event',
      'assertion-confirmation-event',
    ])
    expect(result.metrics.find(metric => metric.key === 'is_bold_enabled')?.value)
      .toBe(true)
    expect(
      result.metrics.find(metric => metric.key === 'search_window_blocks')?.value
    ).toBe(100n)
    expect(result.findings[0].code).toBe('confirmation_delay_exceeded')
  })
})
