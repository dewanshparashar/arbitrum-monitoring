import { describe, expect, test, vi } from 'vitest'
import { MonitorRunResult } from 'monitor-core'
import { SqliteMonitorStore } from 'storage'
import { runDueMonitors } from '../runner'
import { MonitorExecutor } from '../types'
import { ChildNetwork } from 'utils'

const childChains = [
  {
    chainId: 42161,
    parentChainId: 1,
    name: 'Arbitrum One',
    parentRpcUrl: 'https://parent.example',
    orbitRpcUrl: 'https://child.example',
    explorerUrl: 'https://child.explorer',
    parentExplorerUrl: 'https://parent.explorer',
  },
  {
    chainId: 42170,
    parentChainId: 1,
    name: 'Arbitrum Nova',
    parentRpcUrl: 'https://parent.example',
    orbitRpcUrl: 'https://child-nova.example',
    explorerUrl: 'https://nova.explorer',
    parentExplorerUrl: 'https://parent.explorer',
  },
] as ChildNetwork[]

const createResult = (
  monitor: MonitorExecutor['type'],
  chain: ChildNetwork,
  startedAt: number
): MonitorRunResult => ({
  monitor,
  chainId: chain.chainId,
  chainName: chain.name,
  startedAt,
  finishedAt: startedAt + 10,
  status: 'ok',
  observations: [],
  metrics: [],
  findings: [],
})

describe('runDueMonitors', () => {
  test('persists successful and failed runs and respects monitor cadence', async () => {
    const store = new SqliteMonitorStore(':memory:')
    const logger = {
      log: vi.fn(),
      error: vi.fn(),
    }
    let startedAt = 10
    const assertionRun = vi.fn(async (chain: ChildNetwork) =>
      createResult('assertion', chain, startedAt++)
    )
    const retryableRun = vi.fn(async () => {
      throw new Error('rpc timeout')
    })
    const scheduleState = {}
    const monitors: MonitorExecutor[] = [
      {
        type: 'assertion',
        intervalMs: 1000,
        run: assertionRun,
      },
      {
        type: 'retryable',
        intervalMs: 5000,
        run: retryableRun,
      },
    ]

    store.initialize()

    const firstResults = await runDueMonitors({
      childChains,
      monitors,
      store,
      scheduleState,
      runContext: { lookbackHours: 3 },
      chainConcurrency: 2,
      logger,
      now: 1000,
    })

    expect(firstResults).toHaveLength(4)
    expect(
      store.readMonitorHistory({
        monitor: 'assertion',
        chainId: 42161,
        since: 0,
      })
    ).toHaveLength(1)
    expect(
      store.readMonitorHistory({
        monitor: 'assertion',
        chainId: 42170,
        since: 0,
      })
    ).toHaveLength(1)
    expect(
      store.readMonitorHistory({
        monitor: 'retryable',
        chainId: 42161,
        since: 0,
      })[0]
    ).toMatchObject({
      status: 'error',
      error: 'rpc timeout',
    })
    expect(
      store.readMonitorHistory({
        monitor: 'retryable',
        chainId: 42170,
        since: 0,
      })[0]
    ).toMatchObject({
      status: 'error',
      error: 'rpc timeout',
    })

    const secondResults = await runDueMonitors({
      childChains,
      monitors,
      store,
      scheduleState,
      logger,
      now: 1500,
    })

    expect(secondResults).toHaveLength(0)

    const thirdResults = await runDueMonitors({
      childChains,
      monitors,
      store,
      scheduleState,
      logger,
      now: 2500,
    })

    expect(thirdResults).toHaveLength(2)
    expect(assertionRun).toHaveBeenCalledTimes(4)
    expect(retryableRun).toHaveBeenCalledTimes(2)

    store.close()
  })

  test('starts multiple chains in parallel when concurrency is greater than one', async () => {
    const store = new SqliteMonitorStore(':memory:')
    const logger = {
      log: vi.fn(),
      error: vi.fn(),
    }
    const resolvers: Array<() => void> = []
    const run = vi.fn(
      (chain: ChildNetwork) =>
        new Promise<MonitorRunResult>(resolve => {
          resolvers.push(() =>
            resolve(createResult('assertion', chain, Date.now()))
          )
        })
    )

    store.initialize()

    const pending = runDueMonitors({
      childChains,
      monitors: [
        {
          type: 'assertion',
          intervalMs: 1000,
          run,
        },
      ],
      store,
      scheduleState: {},
      chainConcurrency: 2,
      logger,
      now: 1000,
    })

    await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(2)

    for (const resolve of resolvers) {
      resolve()
    }

    await pending
    store.close()
  })
})
