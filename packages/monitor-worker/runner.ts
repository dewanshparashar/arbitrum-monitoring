import { MonitorRunResult } from 'monitor-core'
import { MonitorStore } from 'storage'
import { ChildNetwork, sleep } from 'utils'
import {
  MonitorExecutor,
  MonitorRunContext,
  WorkerLoopOptions,
  WorkerScheduleState,
} from './types'

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
  chain: ChildNetwork,
  context?: MonitorRunContext
) => {
  const startedAt = Date.now()

  try {
    return await monitor.run(chain, context)
  } catch (error) {
    return createErrorMonitorResult({
      type: monitor.type,
      chain,
      startedAt,
      error: error as Error,
    })
  }
}

const runMonitorForChain = async ({
  monitor,
  chain,
  index,
  total,
  store,
  runContext,
  logger,
}: {
  monitor: MonitorExecutor
  chain: ChildNetwork
  index: number
  total: number
  store: MonitorStore
  runContext?: MonitorRunContext
  logger: Pick<Console, 'log' | 'error'>
}) => {
  const chainStartedAt = Date.now()
  logger.log(
    `[${monitor.type}] Starting [${chain.name}] (${chain.chainId}) ${
      index + 1
    }/${total}`
  )
  const result = await runMonitorSafely(monitor, chain, runContext)
  await store.persistResult(result)

  if (result.status === 'error') {
    logger.error(
      `[${monitor.type}] Failed [${chain.name}] after ${
        Date.now() - chainStartedAt
      }ms: ${result.error}`
    )
    return result
  }

  logger.log(
    `[${monitor.type}] Finished [${chain.name}] with ${result.status} in ${
      Date.now() - chainStartedAt
    }ms`
  )
  return result
}

const runMonitorAcrossChains = async ({
  childChains,
  monitor,
  chainConcurrency,
  store,
  runContext,
  logger,
}: {
  childChains: ChildNetwork[]
  monitor: MonitorExecutor
  chainConcurrency: number
  store: MonitorStore
  runContext?: MonitorRunContext
  logger: Pick<Console, 'log' | 'error'>
}) => {
  const concurrency = Math.min(chainConcurrency, childChains.length)
  const results = new Array<MonitorRunResult | undefined>(childChains.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextIndex++
        if (index >= childChains.length) {
          return
        }

        results[index] = await runMonitorForChain({
          monitor,
          chain: childChains[index],
          index,
          total: childChains.length,
          store,
          runContext,
          logger,
        })
      }
    })
  )

  return results.filter(Boolean) as MonitorRunResult[]
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
  runContext,
  chainConcurrency,
  logger = console,
  now = Date.now(),
}: {
  childChains: ChildNetwork[]
  monitors: MonitorExecutor[]
  store: MonitorStore
  scheduleState: WorkerScheduleState
  runContext?: MonitorRunContext
  chainConcurrency?: number
  logger?: Pick<Console, 'log' | 'error'>
  now?: number
}) => {
  const dueMonitors = monitors.filter(monitor =>
    isDue(monitor, scheduleState, now)
  )
  const results: MonitorRunResult[] = []

  for (const monitor of dueMonitors) {
    logger.log(
      `[worker] Running ${monitor.type} monitor across ${
        childChains.length
      } chains with concurrency ${chainConcurrency ?? 1}`
    )
    results.push(
      ...(await runMonitorAcrossChains({
        childChains,
        monitor,
        chainConcurrency: chainConcurrency ?? 1,
        store,
        runContext,
        logger,
      }))
    )

    scheduleState[monitor.type] = now
    logger.log(`[worker] Finished ${monitor.type} monitor`)
  }

  await store.pruneOldRuns(now)
  logger.log('[worker] Pruned old runs')
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
  store: MonitorStore
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
      runContext: {
        lookbackHours: loop.lookbackHours,
      },
      chainConcurrency: loop.chainConcurrency,
      logger,
    })

    if (loop.once) {
      return
    }

    await sleep(loop.pollIntervalMs)
  } while (true)
}
