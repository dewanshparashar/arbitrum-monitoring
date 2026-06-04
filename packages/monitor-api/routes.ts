import { MonitorType } from 'monitor-core'
import { MonitorStore } from 'storage'
import {
  serializeFinding,
  serializeMetric,
  serializeObservation,
  serializeRun,
  serializeSnapshot,
} from './serialize'

interface ApiResponse {
  status: number
  body: unknown
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

const isMonitorType = (value: string): value is MonitorType =>
  value === 'assertion' || value === 'batch-poster' || value === 'retryable'

const asChainId = (value: string) => {
  const chainId = Number(value)
  return Number.isFinite(chainId) ? chainId : null
}

const asDays = (value: string | null) => {
  if (!value) return 14
  const days = Number(value)
  return Number.isFinite(days) ? days : null
}

const buildOverview = (snapshots: ReturnType<typeof serializeSnapshot>[]) => {
  const chainMap = new Map<number, { chainId: number; chainName: string }>()
  let okCount = 0
  let partialCount = 0
  let errorCount = 0
  let infoCount = 0
  let warningCount = 0
  let criticalCount = 0

  for (const snapshot of snapshots) {
    if (!snapshot || snapshot.chainId === undefined) continue
    chainMap.set(snapshot.chainId, {
      chainId: snapshot.chainId,
      chainName: String(snapshot.chainName),
    })

    if (snapshot.status === 'ok') okCount++
    if (snapshot.status === 'partial') partialCount++
    if (snapshot.status === 'error') errorCount++

    const summary = snapshot.summary as
      | {
          finding_counts?: {
            info?: number
            warning?: number
            critical?: number
          }
        }
      | null
      | undefined

    infoCount += summary?.finding_counts?.info ?? 0
    warningCount += summary?.finding_counts?.warning ?? 0
    criticalCount += summary?.finding_counts?.critical ?? 0
  }

  return {
    chains: chainMap.size,
    snapshots: snapshots.length,
    statuses: {
      ok: okCount,
      partial: partialCount,
      error: errorCount,
    },
    findings: {
      info: infoCount,
      warning: warningCount,
      critical: criticalCount,
    },
  }
}

const buildChains = (snapshots: ReturnType<typeof serializeSnapshot>[]) => {
  const chainMap = new Map<
    number,
    {
      chainId: number
      chainName: string
      monitors: Record<string, ReturnType<typeof serializeSnapshot>>
    }
  >()

  for (const snapshot of snapshots) {
    if (!snapshot || snapshot.chainId === undefined) continue

    const chain =
      chainMap.get(snapshot.chainId) ||
      {
        chainId: snapshot.chainId,
        chainName: String(snapshot.chainName),
        monitors: {},
      }

    chain.monitors[String(snapshot.monitor)] = snapshot
    chainMap.set(snapshot.chainId, chain)
  }

  return Array.from(chainMap.values()).sort((left, right) =>
    left.chainName.localeCompare(right.chainName)
  )
}

export const handleApiRequest = async ({
  method,
  pathname,
  searchParams,
  store,
}: {
  method: string
  pathname: string
  searchParams: URLSearchParams
  store: MonitorStore
}): Promise<ApiResponse> => {
  if (method !== 'GET') {
    return badRequest('Only GET is supported.')
  }

  if (pathname === '/health') {
    return ok({ ok: true })
  }

  if (pathname === '/api/overview') {
    const snapshots = (await store.readLatestSnapshots()).map(serializeSnapshot)
    return ok(buildOverview(snapshots))
  }

  if (pathname === '/api/chains') {
    const snapshots = (await store.readLatestSnapshots()).map(serializeSnapshot)
    return ok(buildChains(snapshots))
  }

  const chainLatestMatch = pathname.match(
    /^\/api\/chains\/([^/]+)\/([^/]+)\/latest$/
  )
  if (chainLatestMatch) {
    const [, chainIdValue, monitorValue] = chainLatestMatch
    const chainId = asChainId(chainIdValue)
    if (chainId === null) return badRequest('Invalid chain id.')
    if (!isMonitorType(monitorValue)) return badRequest('Invalid monitor type.')

    const snapshot = serializeSnapshot(
      await store.readLatestSnapshot(monitorValue, chainId)
    )
    if (!snapshot) {
      return notFound('Snapshot not found.')
    }

    const run = serializeRun(await store.readRun(String(snapshot.runId)))

    return ok({
      snapshot,
      run,
    })
  }

  const chainHistoryMatch = pathname.match(
    /^\/api\/chains\/([^/]+)\/([^/]+)\/history$/
  )
  if (chainHistoryMatch) {
    const [, chainIdValue, monitorValue] = chainHistoryMatch
    const chainId = asChainId(chainIdValue)
    const days = asDays(searchParams.get('days'))
    const limit = searchParams.get('limit')
      ? Number(searchParams.get('limit'))
      : 100

    if (chainId === null) return badRequest('Invalid chain id.')
    if (!isMonitorType(monitorValue)) return badRequest('Invalid monitor type.')
    if (days === null) return badRequest('Invalid days query parameter.')
    if (!Number.isFinite(limit)) return badRequest('Invalid limit query parameter.')

    const since = Date.now() - days * 24 * 60 * 60 * 1000
    const runs = (await store.readMonitorHistory({
      monitor: monitorValue,
      chainId,
      since,
      limit,
    })).map(serializeRun)

    return ok({
      monitor: monitorValue,
      chainId,
      days,
      runs,
    })
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/)
  if (runMatch) {
    const runId = runMatch[1]
    const run = serializeRun(await store.readRun(runId))

    if (!run) {
      return notFound('Run not found.')
    }

    const [observations, metrics, findings] = await Promise.all([
      store.readRunObservations(runId),
      store.readRunMetrics(runId),
      store.readRunFindings(runId),
    ])

    return ok({
      run,
      observations: observations.map(serializeObservation),
      metrics: metrics.map(serializeMetric),
      findings: findings.map(serializeFinding),
    })
  }

  return notFound('Route not found.')
}
