import { describe, expect, test } from 'vitest'
import { MonitorRunResult } from 'monitor-core'
import { SqliteMonitorStore, createMonitorRunId } from 'storage'
import { handleApiRequest } from '../routes'

const now = Date.now()

const result: MonitorRunResult = {
  monitor: 'assertion',
  chainId: 42161,
  chainName: 'Arbitrum One',
  startedAt: now - 1_000,
  finishedAt: now,
  status: 'partial',
  observations: [
    {
      id: 'obs-1',
      monitor: 'assertion',
      chainId: 42161,
      observedAt: 200,
      kind: 'assertion-window',
      data: { fromBlock: 1, toBlock: 2 },
    },
  ],
  metrics: [
    {
      key: 'assertions_missing',
      monitor: 'assertion',
      chainId: 42161,
      observedAt: 200,
      value: 1,
    },
  ],
  findings: [
    {
      code: 'assertions_missing',
      monitor: 'assertion',
      chainId: 42161,
      severity: 'critical',
      title: 'Assertions missing',
      message: 'No recent assertions found.',
    },
  ],
}

describe('handleApiRequest', () => {
  test('serves chains, overview, latest, history, and run details', async () => {
    const store = new SqliteMonitorStore(':memory:')
    store.initialize()
    store.persistResult(result)

    const health = await handleApiRequest({
      method: 'GET',
      pathname: '/health',
      searchParams: new URLSearchParams(),
      store,
    })
    const overview = await handleApiRequest({
      method: 'GET',
      pathname: '/api/overview',
      searchParams: new URLSearchParams(),
      store,
    })
    const chains = await handleApiRequest({
      method: 'GET',
      pathname: '/api/chains',
      searchParams: new URLSearchParams(),
      store,
    })
    const latest = await handleApiRequest({
      method: 'GET',
      pathname: '/api/chains/42161/assertion/latest',
      searchParams: new URLSearchParams(),
      store,
    })
    const history = await handleApiRequest({
      method: 'GET',
      pathname: '/api/chains/42161/assertion/history',
      searchParams: new URLSearchParams('days=14'),
      store,
    })
    const run = await handleApiRequest({
      method: 'GET',
      pathname: `/api/runs/${createMonitorRunId(result)}`,
      searchParams: new URLSearchParams(),
      store,
    })

    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({
      ok: true,
      store: 'sqlite',
      overview: {
        chains: 1,
        snapshots: 1,
      },
    })
    expect(overview.status).toBe(200)
    expect(overview.body).toMatchObject({
      chains: 1,
      statuses: { ok: 0, partial: 1, error: 0 },
      findings: { critical: 1 },
    })
    expect(chains.status).toBe(200)
    expect(chains.body).toMatchObject([
      {
        chainId: 42161,
        chainName: 'Arbitrum One',
      },
    ])
    expect(latest.status).toBe(200)
    expect(latest.body).toMatchObject({
      snapshot: {
        monitor: 'assertion',
        chainId: 42161,
      },
      run: {
        id: createMonitorRunId(result),
        status: 'partial',
      },
    })
    expect(history.status).toBe(200)
    expect(history.body).toMatchObject({
      monitor: 'assertion',
      chainId: 42161,
      runs: [{ id: createMonitorRunId(result) }],
    })
    expect(run.status).toBe(200)
    expect(run.body).toMatchObject({
      run: { id: createMonitorRunId(result) },
      observations: [{ id: `${createMonitorRunId(result)}:observation:obs-1` }],
      metrics: [{ key: 'assertions_missing', value: 1 }],
      findings: [{ code: 'assertions_missing' }],
    })

    store.close()
  })

  test('returns 404s and 400s for bad routes', async () => {
    const store = new SqliteMonitorStore(':memory:')
    store.initialize()

    const missing = await handleApiRequest({
      method: 'GET',
      pathname: '/api/chains/1/assertion/latest',
      searchParams: new URLSearchParams(),
      store,
    })
    const bad = await handleApiRequest({
      method: 'GET',
      pathname: '/api/chains/not-a-chain/assertion/history',
      searchParams: new URLSearchParams(),
      store,
    })

    expect(missing.status).toBe(404)
    expect(bad.status).toBe(400)

    store.close()
  })
})
