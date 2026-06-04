import { describe, expect, test } from 'vitest'
import { MonitorRunResult } from 'monitor-core'
import { SqliteMonitorStore } from 'storage'
import { handleVercelRequest } from '../vercel'

const now = Date.now()

const result: MonitorRunResult = {
  monitor: 'assertion',
  chainId: 42161,
  chainName: 'Arbitrum One',
  startedAt: now - 1_000,
  finishedAt: now,
  status: 'ok',
  observations: [],
  metrics: [],
  findings: [],
}

describe('handleVercelRequest', () => {
  test('serves api routes rewritten through pathname', async () => {
    const store = new SqliteMonitorStore(':memory:')
    await store.initialize()
    await store.persistResult(result)

    const response = await handleVercelRequest(
      new Request(
        'https://example.vercel.app/api/v1?pathname=/api/chains/42161/assertion/latest'
      ),
      store
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      snapshot: {
        monitor: 'assertion',
        chainId: 42161,
      },
    })

    await store.close()
  })

  test('keeps non-pathname query params for history', async () => {
    const store = new SqliteMonitorStore(':memory:')
    await store.initialize()
    await store.persistResult(result)

    const response = await handleVercelRequest(
      new Request(
        'https://example.vercel.app/api/v1?pathname=/api/chains/42161/assertion/history&days=14'
      ),
      store
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      chainId: 42161,
      days: 14,
      runs: [{ monitor: 'assertion' }],
    })

    await store.close()
  })
})
