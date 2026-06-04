import { ChildNetwork } from 'utils'
import { providers } from 'ethers'
import {
  DerivedFinding,
  MonitorRunResult,
  RawMetric,
  RawObservation,
} from 'monitor-core'

// Type for options passed to findRetryables function
export interface FindRetryablesOptions {
  fromBlock: number
  toBlock: number
  continuous: boolean
  configPath: string
  enableAlerting: boolean
  writeToNotion: boolean
  autoRedeem?: boolean
}

export interface CheckRetryablesOneOffParams {
  parentChainProvider: providers.Provider
  childChainProvider: providers.Provider
  childChain: ChildNetwork
  fromBlock: number
  toBlock: number
  enableAlerting: boolean
  onFailedRetryableFound?: OnFailedRetryableFound
  onRedeemedRetryableFound?: OnRedeemedRetryableFound
}

export interface CheckRetryablesContinuousParams
  extends CheckRetryablesOneOffParams {
  continuous: boolean
}

export interface ParentChainTicketReport {
  id: string
  transactionHash: string
  sender: string
  retryableTicketID: string
}

export interface ChildChainTicketReport {
  id: string
  retryTxHash?: string
  createdAtTimestamp: string
  createdAtBlockNumber: number
  timeoutTimestamp: string
  deposit: string
  status: string
  retryTo: string
  retryData: string
  gasFeeCap: number
  gasLimit: number
  l2CallValue?: string       
  feeRefundAddress?: string  
  beneficiary?: string 
}

export interface TokenDepositData {
  l2TicketId: string
  tokenAmount?: string
  sender: string
  l1Token: {
    symbol: string
    decimals: number
    id: string
  }
}

export interface OnRetryableFoundParams {
  ChildTx: string
  ParentTx: string // raw hash
  ParentTxUrl: string // full explorer URL
  createdAt: number
  timeout?: number
  status:string
  decision?: string
  chainId: number
  chain: string
  metadata?: {
    tokensDeposited?: string
    gasPriceProvided: string
    gasPriceAtCreation?: string
    gasPriceNow: string
    l2CallValue?: string 
    feeRefundAddress?: string
    beneficiary?: string
    retryTo?: string
    retryData?: string
    botRedemptionStatus?: string
    
  }
}

export interface OnFailedRetryableFoundParams {
  parentChainRetryableReport: ParentChainTicketReport
  childChainRetryableReport: ChildChainTicketReport
  tokenDepositData?: TokenDepositData
  childChain: ChildNetwork
}

export interface ObservedRetryableTicket {
  parentChainRetryableReport: ParentChainTicketReport
  childChainRetryableReport?: ChildChainTicketReport
  tokenDepositData?: TokenDepositData
  childChain: ChildNetwork
  status: string
  parentTxHash: string
  childTxHash: string
  parentTxUrl: string
  childTxUrl: string
  receiptFound: boolean
}

export interface CheckRetryablesOneOffResult {
  fromBlock: number
  toBlock: number
  lastBlockChecked: number
  tickets: ObservedRetryableTicket[]
}

export type RetryableObservationKind =
  | 'retryable-scan-window'
  | 'retryable-parent-transaction'
  | 'retryable-ticket-status'
  | 'retryable-token-deposit'

export interface RetryableObservation extends RawObservation {
  monitor: 'retryable'
  kind: RetryableObservationKind
}

export type RetryableMetricKey =
  | 'tickets_total'
  | 'tickets_executed'
  | 'tickets_pending'
  | 'tickets_expired'
  | 'tickets_without_receipt'
  | 'tickets_with_token_deposit'
  | 'expiring_within_72h'
  | 'scan_from_block'
  | 'scan_to_block'

export interface RetryableMetric extends RawMetric {
  monitor: 'retryable'
  key: RetryableMetricKey
}

export type RetryableFindingCode =
  | 'ticket_not_yet_created'
  | 'ticket_funds_deposited_on_child'
  | 'ticket_creation_failed'
  | 'ticket_expired'
  | 'ticket_redeem_scheduled'
  | 'ticket_receipt_missing'

export interface RetryableFinding extends DerivedFinding {
  monitor: 'retryable'
  code: RetryableFindingCode
}

export type RetryableMonitorResult = MonitorRunResult<
  RetryableObservation,
  RetryableMetric,
  RetryableFinding
>

export type OnFailedRetryableFound = (
  params: OnFailedRetryableFoundParams
) => Promise<void>

export type OnRedeemedRetryableFound = (
  params: OnRetryableFoundParams
) => Promise<void>
