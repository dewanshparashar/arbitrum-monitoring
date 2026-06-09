import { describe, expect, test, vi } from 'vitest'
import { handleApiRequest } from '../routes'

const createFleetDb = () => ({
  healthCheck: vi.fn(async () => ({
    ok: true,
    snapshotGeneratedAt: '2026-06-09T00:00:00.000Z',
  })),
  readFleetOverview: vi.fn(async () => ({
    chains: 26,
    alerts: 4,
  })),
  readFleetChains: vi.fn(async () => [
    {
      chainId: 42161,
      chainName: 'Arbitrum One',
    },
  ]),
  readFleetChainDetail: vi.fn(async (chainId: number) =>
    chainId === 42161
      ? {
          chain: {
            chainId,
            chainName: 'Arbitrum One',
          },
        }
      : null
  ),
})

describe('handleApiRequest', () => {
  test('serves fleet routes', async () => {
    const fleetDb = createFleetDb()

    const health = await handleApiRequest({
      method: 'GET',
      pathname: '/health',
      fleetDb,
    })
    const overview = await handleApiRequest({
      method: 'GET',
      pathname: '/api/fleet/overview',
      fleetDb,
    })
    const chains = await handleApiRequest({
      method: 'GET',
      pathname: '/api/fleet/chains',
      fleetDb,
    })
    const detail = await handleApiRequest({
      method: 'GET',
      pathname: '/api/fleet/chains/42161',
      fleetDb,
    })

    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({
      ok: true,
      fleet: { ok: true },
    })
    expect(overview.status).toBe(200)
    expect(overview.body).toMatchObject({
      chains: 26,
      alerts: 4,
    })
    expect(chains.status).toBe(200)
    expect(chains.body).toMatchObject([
      {
        chainId: 42161,
        chainName: 'Arbitrum One',
      },
    ])
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({
      chain: {
        chainId: 42161,
      },
    })
  })

  test('returns route errors', async () => {
    const fleetDb = createFleetDb()

    const unavailable = await handleApiRequest({
      method: 'GET',
      pathname: '/api/fleet/overview',
    })
    const missing = await handleApiRequest({
      method: 'GET',
      pathname: '/api/fleet/chains/999999',
      fleetDb,
    })
    const bad = await handleApiRequest({
      method: 'GET',
      pathname: '/api/fleet/chains/not-a-chain',
      fleetDb,
    })

    expect(unavailable.status).toBe(400)
    expect(missing.status).toBe(404)
    expect(bad.status).toBe(400)
  })
})
