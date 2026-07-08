interface ApiResponse {
  status: number
  body: unknown
}

export interface FleetDbLike {
  healthCheck: () => Promise<unknown>
  readFleetOverview: () => Promise<unknown>
  readFleetChains: () => Promise<unknown>
  readFleetChainDetail: (chainId: number) => Promise<unknown>
  readFleetStatus: () => Promise<unknown>
}

const ok = (body: unknown): ApiResponse => ({
  status: 200,
  body,
})

const notFound = (message: string): ApiResponse => ({
  status: 404,
  body: { error: message },
})

const badRequest = (message: string): ApiResponse => ({
  status: 400,
  body: { error: message },
})

const asChainId = (value: string) => {
  const chainId = Number(value)
  return Number.isFinite(chainId) ? chainId : null
}

export const handleApiRequest = async ({
  method,
  pathname,
  fleetDb,
}: {
  method: string
  pathname: string
  fleetDb?: FleetDbLike
}): Promise<ApiResponse> => {
  if (method !== 'GET') {
    return badRequest('Only GET is supported.')
  }

  if (pathname === '/api/fleet/overview') {
    if (!fleetDb) return badRequest('Fleet indexer database is unavailable.')
    return ok(await fleetDb.readFleetOverview())
  }

  if (pathname === '/api/fleet/chains') {
    if (!fleetDb) return badRequest('Fleet indexer database is unavailable.')
    return ok(await fleetDb.readFleetChains())
  }

  if (pathname === '/api/fleet/status') {
    if (!fleetDb) return badRequest('Fleet indexer database is unavailable.')
    return ok(await fleetDb.readFleetStatus())
  }

  const fleetChainMatch = pathname.match(/^\/api\/fleet\/chains\/([^/]+)$/)
  if (fleetChainMatch) {
    if (!fleetDb) return badRequest('Fleet indexer database is unavailable.')

    const chainId = asChainId(fleetChainMatch[1]!)
    if (chainId === null) return badRequest('Invalid chain id.')

    const detail = await fleetDb.readFleetChainDetail(chainId)
    if (!detail) {
      return notFound('Fleet chain not found.')
    }

    return ok(detail)
  }

  if (pathname === '/health') {
    try {
      return ok({
        ok: !!fleetDb,
        fleet: fleetDb ? await fleetDb.healthCheck() : null,
      })
    } catch (error) {
      return {
        status: 503,
        body: {
          ok: false,
          error: error instanceof Error ? error.message : 'Health check failed.',
        },
      }
    }
  }

  return notFound('Route not found.')
}
