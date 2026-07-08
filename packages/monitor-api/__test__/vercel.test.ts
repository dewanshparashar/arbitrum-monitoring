import { describe, expect, test } from 'vitest'
import { handleVercelRequest } from '../vercel'

const fleetDb = {
  healthCheck: async () => ({
    ok: true,
    snapshotGeneratedAt: '2026-06-09T00:00:00.000Z',
  }),
  readFleetOverview: async () => ({
    chains: 26,
  }),
  readFleetChains: async () => [],
  readFleetChainDetail: async () => null,
  readFleetStatus: async () => ({ worker: null, indexer: { parents: [] }, freshness: {}, exitBacklog: [] }),
}

describe('handleVercelRequest', () => {
  test('serves rewritten fleet routes', async () => {
    const response = await handleVercelRequest(
      new Request(
        'https://example.vercel.app/api/v1?pathname=/api/fleet/overview'
      ),
      fleetDb
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      chains: 26,
    })
  })

  test('falls back to the request pathname', async () => {
    const response = await handleVercelRequest(
      new Request('https://example.vercel.app/health'),
      fleetDb
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      fleet: {
        ok: true,
      },
    })
  })
})
