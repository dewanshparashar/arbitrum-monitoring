import { MonitorRunResult } from 'monitor-core'
import { SqliteMonitorStore } from 'storage'
import { ChildNetwork, sleep } from 'utils'
import { MonitorExecutor, WorkerLoopOptions, WorkerScheduleState } from './types'

const createErrorMonitorResult = ({
  type,
  chain,
  startedAt,
  error,
}: {
  type: MonitorExecutor['type']
  chain: ChildNetwork
  startedAt: number
  error: Error
}): MonitorRunResult => ({
  monitor: type,
  chainId: chain.chainId,
  chainName: chain.name,
  startedAt,
  finishedAt: Date.now(),
  status: 'error',
  observations: [],
  metrics: [],
  findings: [],
  error: error.message,
  meta: {
    parentChainId: chain.parentChainId,
    parentRpcUrl: chain.parentRpcUrl,
    orbitRpcUrl: chain.orbitRpcUrl,
  },
})

const runMonitorSafely = async (
  monitor: MonitorExecutor,
  chain: ChildNetwork
) => {
  const startedAt = Date.now()

  try {
    return await monitor.run(chain)
  } catch (error) {
    return createErrorMonitorResult({
      type: monitor.type,
      chain,
      startedAt,
      error: error as Error,
    })
  }
}

const isDue = (
  monitor: MonitorExecutor,
  scheduleState: WorkerScheduleState,
  now: number
) => {
  const lastRunAt = scheduleState[monitor.type]
  return !lastRunAt || now - lastRunAt >= monitor.intervalMs
}

export const runDueMonitors = async ({
  childChains,
  monitors,
  store,
  scheduleState,
  logger = console,
  now = Date.now(),
}: {
  childChains: ChildNetwork[]
  monitors: MonitorExecutor[]
  store: SqliteMonitorStore
  scheduleState: WorkerScheduleState
  logger?: Pick<Console, 'log' | 'error'>
  now?: number
}) => {
  const dueMonitors = monitors.filter(monitor => isDue(monitor, scheduleState, now))
  const results: MonitorRunResult[] = []

  for (const monitor of dueMonitors) {
    logger.log(`Running ${monitor.type} monitor across ${childChains.length} chains`)

    for (const chain of childChains) {
      const result = await runMonitorSafely(monitor, chain)
      store.persistResult(result)
      results.push(result)

      if (result.status === 'error') {
        logger.error(
          `${monitor.type} monitor failed for [${chain.name}]: ${result.error}`
        )
      }
    }

    scheduleState[monitor.type] = now
  }

  store.pruneOldRuns(now)
  return results
}

export const runWorkerLoop = async ({
  childChains,
  monitors,
  store,
  loop,
  logger = console,
}: {
  childChains: ChildNetwork[]
  monitors: MonitorExecutor[]
  store: SqliteMonitorStore
  loop: WorkerLoopOptions
  logger?: Pick<Console, 'log' | 'error'>
}) => {
  const scheduleState: WorkerScheduleState = {}

  do {
    await runDueMonitors({
      childChains,
      monitors,
      store,
      scheduleState,
      logger,
    })

    if (loop.once) {
      return
    }

    await sleep(loop.pollIntervalMs)
  } while (true)
}
