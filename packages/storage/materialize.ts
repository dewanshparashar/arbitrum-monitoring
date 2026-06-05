import { MonitorRunResult, MonitorSeverity } from 'monitor-core'
import {
  DerivedFindingRow,
  LatestSnapshotRow,
  LatestSnapshotSummary,
  MonitorResultRows,
  MonitorRunRow,
  RawMetricRow,
  RawObservationRow,
} from './schema'

const toJson = (value: unknown) =>
  JSON.stringify(value, (_, item) =>
    typeof item === 'bigint' ? item.toString() : item
  )

export const createMonitorRunId = (result: MonitorRunResult) =>
  `${result.monitor}:${result.chainId}:${result.startedAt}:${result.finishedAt}`

export const createLatestSnapshotId = (
  monitor: MonitorRunResult['monitor'],
  chainId: number
) => `${monitor}:${chainId}`

const countFindings = (result: MonitorRunResult, severity: MonitorSeverity) =>
  result.findings.filter(item => item.severity === severity).length

const buildSnapshotSummary = (
  result: MonitorRunResult
): LatestSnapshotSummary => ({
  metric_values: Object.fromEntries(
    result.metrics.map(metric => [metric.key, metric.value])
  ),
  finding_counts: {
    info: countFindings(result, 'info'),
    warning: countFindings(result, 'warning'),
    critical: countFindings(result, 'critical'),
  },
})

const buildRunRow = (
  result: MonitorRunResult,
  runId: string
): MonitorRunRow => ({
  id: runId,
  monitor: result.monitor,
  chain_id: result.chainId,
  chain_name: result.chainName,
  started_at: result.startedAt,
  finished_at: result.finishedAt,
  status: result.status,
  error: result.error ?? null,
  meta_json: result.meta ? toJson(result.meta) : null,
})

const buildObservationRows = (
  result: MonitorRunResult,
  runId: string
): RawObservationRow[] =>
  result.observations.map(observation => ({
    id: `${runId}:observation:${observation.id}`,
    run_id: runId,
    monitor: observation.monitor,
    chain_id: observation.chainId,
    observed_at: observation.observedAt,
    kind: observation.kind,
    refs_json: observation.refs ? toJson(observation.refs) : null,
    data_json: toJson(observation.data),
  }))

const buildMetricRows = (
  result: MonitorRunResult,
  runId: string
): RawMetricRow[] =>
  result.metrics.map(metric => ({
    run_id: runId,
    monitor: metric.monitor,
    chain_id: metric.chainId,
    observed_at: metric.observedAt,
    key: metric.key,
    value_json: toJson(metric.value),
    unit: metric.unit ?? null,
    data_json: metric.data ? toJson(metric.data) : null,
  }))

const buildFindingRows = (
  result: MonitorRunResult,
  runId: string
): DerivedFindingRow[] => {
  const observationIdMap = new Map(
    result.observations.map(observation => [
      observation.id,
      `${runId}:observation:${observation.id}`,
    ])
  )

  return result.findings.map((finding, index) => ({
    id: `${runId}:finding:${index}`,
    run_id: runId,
    monitor: finding.monitor,
    chain_id: finding.chainId,
    code: finding.code,
    severity: finding.severity,
    title: finding.title,
    message: finding.message,
    observation_ids_json: finding.observationIds
      ? toJson(
          finding.observationIds.map(
            observationId =>
              observationIdMap.get(observationId) ?? observationId
          )
        )
      : null,
    data_json: finding.data ? toJson(finding.data) : null,
  }))
}

const buildLatestSnapshotRow = (
  result: MonitorRunResult,
  runId: string
): LatestSnapshotRow => ({
  id: createLatestSnapshotId(result.monitor, result.chainId),
  monitor: result.monitor,
  chain_id: result.chainId,
  chain_name: result.chainName,
  run_id: runId,
  updated_at: result.finishedAt,
  status: result.status,
  summary_json: toJson(buildSnapshotSummary(result)),
})

export const materializeMonitorResult = (
  result: MonitorRunResult
): MonitorResultRows => {
  const runId = createMonitorRunId(result)

  return {
    run: buildRunRow(result, runId),
    observations: buildObservationRows(result, runId),
    metrics: buildMetricRows(result, runId),
    findings: buildFindingRows(result, runId),
    latest_snapshot: buildLatestSnapshotRow(result, runId),
  }
}
