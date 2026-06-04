import { SEVEN_DAYS_IN_SECONDS } from '@arbitrum/sdk/dist/lib/dataEntities/constants'
import { ChildNetwork } from 'utils'
import {
  ObservedRetryableTicket,
  RetryableFinding,
  RetryableMetric,
  RetryableMonitorResult,
  RetryableObservation,
} from './core/types'

const createObservationId = (
  kind: RetryableObservation['kind'],
  chainId: number,
  suffix: string
) => `${kind}:${chainId}:${suffix}`

const createMetric = (
  key: RetryableMetric['key'],
  chainId: number,
  observedAt: number,
  value: RetryableMetric['value'],
  unit?: string
): RetryableMetric => ({
  key,
  monitor: 'retryable',
  chainId,
  observedAt,
  value,
  unit,
})

const createFinding = ({
  code,
  chainId,
  severity,
  title,
  message,
  observationId,
}: {
  code: RetryableFinding['code']
  chainId: number
  severity: RetryableFinding['severity']
  title: string
  message: string
  observationId?: string
}): RetryableFinding => ({
  code,
  monitor: 'retryable',
  chainId,
  severity,
  title,
  message,
  observationIds: observationId ? [observationId] : undefined,
})

const findingFromStatus = (
  ticket: ObservedRetryableTicket,
  observationId: string
): RetryableFinding | undefined => {
  const base = {
    chainId: ticket.childChain.chainId,
    observationId,
  }

  switch (ticket.status) {
    case 'NOT_YET_CREATED':
      return createFinding({
        ...base,
        code: 'ticket_not_yet_created',
        severity: 'warning',
        title: 'Retryable not yet created',
        message: `Retryable ${ticket.childTxUrl} is not yet created.`,
      })
    case 'FUNDS_DEPOSITED_ON_CHILD':
      return createFinding({
        ...base,
        code: 'ticket_funds_deposited_on_child',
        severity: 'warning',
        title: 'Retryable awaiting execution',
        message: `Retryable ${ticket.childTxUrl} has funds deposited on child and is awaiting execution.`,
      })
    case 'CREATION_FAILED':
      return createFinding({
        ...base,
        code: 'ticket_creation_failed',
        severity: 'critical',
        title: 'Retryable creation failed',
        message: `Retryable ${ticket.childTxUrl} failed during creation.`,
      })
    case 'EXPIRED':
      return createFinding({
        ...base,
        code: 'ticket_expired',
        severity: 'critical',
        title: 'Retryable expired',
        message: `Retryable ${ticket.childTxUrl} has expired.`,
      })
    case 'REDEEM_SCHEDULED':
      return createFinding({
        ...base,
        code: 'ticket_redeem_scheduled',
        severity: 'info',
        title: 'Retryable redeem scheduled',
        message: `Retryable ${ticket.childTxUrl} has a redeem attempt scheduled.`,
      })
    default:
      return undefined
  }
}

export const buildRetryableMonitorResult = ({
  childChain,
  tickets,
  fromBlock,
  toBlock,
  startedAt,
  finishedAt,
}: {
  childChain: ChildNetwork
  tickets: ObservedRetryableTicket[]
  fromBlock: number
  toBlock: number
  startedAt: number
  finishedAt: number
}): RetryableMonitorResult => {
  const observations: RetryableObservation[] = [
    {
      id: createObservationId(
        'retryable-scan-window',
        childChain.chainId,
        `${fromBlock}-${toBlock}`
      ),
      monitor: 'retryable',
      chainId: childChain.chainId,
      observedAt: finishedAt,
      kind: 'retryable-scan-window',
      data: {
        chainName: childChain.name,
        parentChainId: childChain.parentChainId,
        fromBlock,
        toBlock,
      },
    },
  ]

  const findings: RetryableFinding[] = []

  for (const ticket of tickets) {
    const parentObservationId = createObservationId(
      'retryable-parent-transaction',
      childChain.chainId,
      ticket.parentTxHash
    )
    observations.push({
      id: parentObservationId,
      monitor: 'retryable',
      chainId: childChain.chainId,
      observedAt: finishedAt,
      kind: 'retryable-parent-transaction',
      refs: {
        transactions: [
          {
            chainId: childChain.parentChainId,
            hash: ticket.parentTxHash,
          },
        ],
      },
      data: {
        parentTxHash: ticket.parentTxHash,
        parentTxUrl: ticket.parentTxUrl,
        retryableTicketId: ticket.parentChainRetryableReport.retryableTicketID,
        sender: ticket.parentChainRetryableReport.sender,
      },
    })

    const statusObservationId = createObservationId(
      'retryable-ticket-status',
      childChain.chainId,
      ticket.childTxHash
    )
    observations.push({
      id: statusObservationId,
      monitor: 'retryable',
      chainId: childChain.chainId,
      observedAt: finishedAt,
      kind: 'retryable-ticket-status',
      refs: {
        transactions: [
          {
            chainId: childChain.parentChainId,
            hash: ticket.parentTxHash,
          },
          {
            chainId: childChain.chainId,
            hash: ticket.childTxHash,
          },
        ],
      },
      data: {
        childTxHash: ticket.childTxHash,
        childTxUrl: ticket.childTxUrl,
        status: ticket.status,
        receiptFound: ticket.receiptFound,
        createdAtTimestamp:
          ticket.childChainRetryableReport?.createdAtTimestamp ?? null,
        timeoutTimestamp:
          ticket.childChainRetryableReport?.timeoutTimestamp ?? null,
        gasFeeCap: ticket.childChainRetryableReport?.gasFeeCap ?? null,
        gasLimit: ticket.childChainRetryableReport?.gasLimit ?? null,
        retryTo: ticket.childChainRetryableReport?.retryTo ?? null,
      },
    })

    if (ticket.tokenDepositData) {
      observations.push({
        id: createObservationId(
          'retryable-token-deposit',
          childChain.chainId,
          ticket.childTxHash
        ),
        monitor: 'retryable',
        chainId: childChain.chainId,
        observedAt: finishedAt,
        kind: 'retryable-token-deposit',
        data: {
          tokenAddress: ticket.tokenDepositData.l1Token.id,
          tokenSymbol: ticket.tokenDepositData.l1Token.symbol,
          tokenDecimals: ticket.tokenDepositData.l1Token.decimals,
          tokenAmount: ticket.tokenDepositData.tokenAmount ?? null,
          sender: ticket.tokenDepositData.sender,
        },
      })
    }

    if (!ticket.receiptFound) {
      findings.push(
        createFinding({
          chainId: childChain.chainId,
          code: 'ticket_receipt_missing',
          severity: 'info',
          title: 'Retryable receipt missing',
          message: `Retryable ${ticket.childTxUrl} does not have a child-chain receipt yet.`,
          observationId: statusObservationId,
        })
      )
    }

    const finding = findingFromStatus(ticket, statusObservationId)
    if (finding) findings.push(finding)
  }

  const nowMs = finishedAt
  const expiringWithin72h = tickets.filter(ticket => {
    const timeoutMs = ticket.childChainRetryableReport
      ? Number(ticket.childChainRetryableReport.timeoutTimestamp) * 1000
      : nowMs + SEVEN_DAYS_IN_SECONDS * 1000
    return (
      timeoutMs > nowMs &&
      timeoutMs - nowMs <= 72 * 60 * 60 * 1000 &&
      ticket.status !== 'REDEEMED'
    )
  }).length

  const metrics: RetryableMetric[] = [
    createMetric('scan_from_block', childChain.chainId, finishedAt, fromBlock),
    createMetric('scan_to_block', childChain.chainId, finishedAt, toBlock),
    createMetric('tickets_total', childChain.chainId, finishedAt, tickets.length),
    createMetric(
      'tickets_executed',
      childChain.chainId,
      finishedAt,
      tickets.filter(ticket => ticket.status === 'REDEEMED').length
    ),
    createMetric(
      'tickets_pending',
      childChain.chainId,
      finishedAt,
      tickets.filter(ticket => ticket.status !== 'REDEEMED').length
    ),
    createMetric(
      'tickets_expired',
      childChain.chainId,
      finishedAt,
      tickets.filter(ticket => ticket.status === 'EXPIRED').length
    ),
    createMetric(
      'tickets_without_receipt',
      childChain.chainId,
      finishedAt,
      tickets.filter(ticket => !ticket.receiptFound).length
    ),
    createMetric(
      'tickets_with_token_deposit',
      childChain.chainId,
      finishedAt,
      tickets.filter(ticket => !!ticket.tokenDepositData).length
    ),
    createMetric(
      'expiring_within_72h',
      childChain.chainId,
      finishedAt,
      expiringWithin72h
    ),
  ]

  return {
    monitor: 'retryable',
    chainId: childChain.chainId,
    chainName: childChain.name,
    startedAt,
    finishedAt,
    status: findings.length > 0 ? 'partial' : 'ok',
    observations,
    metrics,
    findings,
    meta: {
      parentChainId: childChain.parentChainId,
      parentRpcUrl: childChain.parentRpcUrl,
      orbitRpcUrl: childChain.orbitRpcUrl,
    },
  }
}
