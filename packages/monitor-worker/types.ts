import { MonitorRunResult, MonitorType } from 'monitor-core'
import { ChildNetwork } from 'utils'

export interface MonitorExecutor {
  type: MonitorType
  intervalMs: number
  run: (chain: ChildNetwork) => Promise<MonitorRunResult>
}

export interface WorkerScheduleState {
  [monitor: string]: number | undefined
}

export interface WorkerLoopOptions {
  once: boolean
  pollIntervalMs: number
}
