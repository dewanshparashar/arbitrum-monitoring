import { MonitorRunResult, MonitorType } from 'monitor-core'

export interface MonitorHistoryParams {
  monitor: MonitorType
  chainId: number
  since: number
  limit?: number
}

export interface MonitorStore {
  initialize(): void | Promise<void>
  persistResult(result: MonitorRunResult): void | Promise<void>
  pruneOldRuns(now?: number, retentionDays?: number): number | Promise<number>
  readLatestSnapshots(
    monitor?: MonitorType
  ):
    | Record<string, unknown>[]
    | Promise<Record<string, unknown>[]>
  readLatestSnapshot(
    monitor: MonitorType,
    chainId: number
  ): Record<string, unknown> | Promise<Record<string, unknown> | undefined> | undefined
  readMonitorHistory(
    params: MonitorHistoryParams
  ): Record<string, unknown>[] | Promise<Record<string, unknown>[]>
  readRun(
    runId: string
  ): Record<string, unknown> | Promise<Record<string, unknown> | undefined> | undefined
  readRunObservations(
    runId: string
  ): Record<string, unknown>[] | Promise<Record<string, unknown>[]>
  readRunMetrics(
    runId: string
  ): Record<string, unknown>[] | Promise<Record<string, unknown>[]>
  readRunFindings(
    runId: string
  ): Record<string, unknown>[] | Promise<Record<string, unknown>[]>
  close(): void | Promise<void>
}
