import { describe, expect, test } from 'vitest'
import { ChildNetwork } from 'utils'
import { buildRetryableMonitorResult } from '../result'
import { ObservedRetryableTicket } from '../core/types'

const childChain = {
  chainId: 421614,
  parentChainId: 11155111,
  name: 'Orbit Test',
  parentRpcUrl: 'https://parent.example',
  orbitRpcUrl: 'https://child.example',
  explorerUrl: 'https://child.explorer',
  parentExplorerUrl: 'https://parent.explorer',
} as ChildNetwork

const baseTicket = {
  parentChainRetryableReport: {
    id: '0xparent',
    transactionHash: '0xparent',
    sender: '0xsender',
    retryableTicketID: '0xchild',
  },
  childChain,
  parentTxHash: '0xparent',
  childTxHash: '0xchild',
  parentTxUrl: 'https://parent.explorer/tx/0xparent',
  childTxUrl: 'https://child.explorer/tx/0xchild',
} satisfies Partial<ObservedRetryableTicket>

describe('buildRetryableMonitorResult', () => {
  test('captures raw retryable observations and findings', () => {
    const result = buildRetryableMonitorResult({
      childChain,
      tickets: [
        {
          ...baseTicket,
          status: 'FUNDS_DEPOSITED_ON_CHILD',
          receiptFound: true,
          childChainRetryableReport: {
            id: '0xchild',
            retryTxHash: '0xredeem',
            createdAtTimestamp: '1710000000000',
            createdAtBlockNumber: 123,
            timeoutTimestamp: String(Math.floor(Date.now() / 1000) + 3600),
            deposit: '100',
            status: 'FUNDS_DEPOSITED_ON_CHILD',
            retryTo: '0xretryto',
            retryData: '0x1234',
            gasFeeCap: 2,
            gasLimit: 3,
          },
          tokenDepositData: {
            l2TicketId: '0xchild',
            tokenAmount: '5000',
            sender: '0xsender',
            l1Token: {
              symbol: 'ARB',
              decimals: 18,
              id: '0xtoken',
            },
          },
        },
        {
          ...baseTicket,
          childTxHash: '0xchild2',
          childTxUrl: 'https://child.explorer/tx/0xchild2',
          status: 'EXPIRED',
          receiptFound: false,
        },
      ] as ObservedRetryableTicket[],
      fromBlock: 100,
      toBlock: 200,
      startedAt: 1,
      finishedAt: 2,
    })

    expect(result.monitor).toBe('retryable')
    expect(result.status).toBe('partial')
    expect(result.observations.map(item => item.kind)).toEqual([
      'retryable-scan-window',
      'retryable-parent-transaction',
      'retryable-ticket-status',
      'retryable-token-deposit',
      'retryable-parent-transaction',
      'retryable-ticket-status',
    ])
    expect(result.metrics.find(item => item.key === 'tickets_total')?.value).toBe(
      2
    )
    expect(
      result.findings.map(item => item.code).sort((left, right) =>
        left.localeCompare(right)
      )
    ).toEqual([
      'ticket_expired',
      'ticket_funds_deposited_on_child',
      'ticket_receipt_missing',
    ])
  })
})
