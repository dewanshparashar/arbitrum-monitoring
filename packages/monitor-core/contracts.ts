export type MonitorType = 'assertion' | 'batch-poster' | 'retryable'

export type MonitorRunStatus = 'ok' | 'partial' | 'error'

export type MonitorSeverity = 'info' | 'warning' | 'critical'

export type MonitorValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | MonitorValue[]
  | { [key: string]: MonitorValue }

export interface BlockRef {
  chainId: number
  number: bigint
  hash?: string
  timestamp?: number
}

export interface TransactionRef {
  chainId: number
  hash: string
  blockNumber?: bigint
  blockHash?: string
  transactionIndex?: number
}

export interface LogRef {
  chainId: number
  blockNumber: bigint
  transactionHash: string
  logIndex: number
  address?: string
  eventName?: string
}

export interface SourceRefs {
  blocks?: BlockRef[]
  transactions?: TransactionRef[]
  logs?: LogRef[]
}

export interface RawObservation {
  id: string
  monitor: MonitorType
  chainId: number
  observedAt: number
  kind: string
  refs?: SourceRefs
  data: Record<string, MonitorValue>
}

export interface RawMetric {
  key: string
  monitor: MonitorType
  chainId: number
  observedAt: number
  value: MonitorValue
  unit?: string
  data?: Record<string, MonitorValue>
}

export interface DerivedFinding {
  code: string
  monitor: MonitorType
  chainId: number
  severity: MonitorSeverity
  title: string
  message: string
  observationIds?: string[]
  data?: Record<string, MonitorValue>
}

export interface MonitorRunResult<
  TObservation extends RawObservation = RawObservation,
  TMetric extends RawMetric = RawMetric,
  TFinding extends DerivedFinding = DerivedFinding,
> {
  monitor: MonitorType
  chainId: number
  chainName: string
  startedAt: number
  finishedAt: number
  status: MonitorRunStatus
  observations: TObservation[]
  metrics: TMetric[]
  findings: TFinding[]
  error?: string
  meta?: Record<string, MonitorValue>
}
