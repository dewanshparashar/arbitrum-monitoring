const asNumber = (value: unknown) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return undefined
}

const parseJson = (value: unknown) => {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  return JSON.parse(value)
}

export const serializeRun = (row: Record<string, unknown> | undefined) => {
  if (!row) return null

  return {
    id: row.id,
    monitor: row.monitor,
    chainId: asNumber(row.chain_id),
    chainName: row.chain_name,
    startedAt: asNumber(row.started_at),
    finishedAt: asNumber(row.finished_at),
    status: row.status,
    error: row.error ?? null,
    meta: parseJson(row.meta_json),
  }
}

export const serializeSnapshot = (row: Record<string, unknown> | undefined) => {
  if (!row) return null

  return {
    id: row.id,
    monitor: row.monitor,
    chainId: asNumber(row.chain_id),
    chainName: row.chain_name,
    runId: row.run_id,
    updatedAt: asNumber(row.updated_at),
    status: row.status,
    summary: parseJson(row.summary_json),
  }
}

export const serializeObservation = (row: Record<string, unknown>) => ({
  id: row.id,
  runId: row.run_id,
  monitor: row.monitor,
  chainId: asNumber(row.chain_id),
  observedAt: asNumber(row.observed_at),
  kind: row.kind,
  refs: parseJson(row.refs_json),
  data: parseJson(row.data_json),
})

export const serializeMetric = (row: Record<string, unknown>) => ({
  runId: row.run_id,
  monitor: row.monitor,
  chainId: asNumber(row.chain_id),
  observedAt: asNumber(row.observed_at),
  key: row.key,
  value: parseJson(row.value_json),
  unit: row.unit ?? null,
  data: parseJson(row.data_json),
})

export const serializeFinding = (row: Record<string, unknown>) => ({
  id: row.id,
  runId: row.run_id,
  monitor: row.monitor,
  chainId: asNumber(row.chain_id),
  code: row.code,
  severity: row.severity,
  title: row.title,
  message: row.message,
  observationIds: parseJson(row.observation_ids_json),
  data: parseJson(row.data_json),
})
