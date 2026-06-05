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
      logger,
      now: 1000,
    })

    expect(firstResults).toHaveLength(2)
    expect(
      store.readMonitorHistory({
        monitor: 'assertion',
        chainId: 42161,
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

    expect(thirdResults).toHaveLength(1)
    expect(assertionRun).toHaveBeenCalledTimes(2)
    expect(retryableRun).toHaveBeenCalledTimes(1)

    store.close()
  })
})
