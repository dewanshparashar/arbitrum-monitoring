import {
  DerivedFindingRow,
  LatestSnapshotRow,
  MonitorRunRow,
  RawMetricRow,
  RawObservationRow,
} from './schema'

export interface SqlQuery {
  sql: string
  params: unknown[]
}

export const insertMonitorRunQuery = (row: MonitorRunRow): SqlQuery => ({
  sql: `
    INSERT INTO monitor_runs (
      id, monitor, chain_id, chain_name, started_at, finished_at, status, error, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `,
  params: [
    row.id,
    row.monitor,
    row.chain_id,
    row.chain_name,
    row.started_at,
    row.finished_at,
    row.status,
    row.error,
    row.meta_json,
  ],
})

export const insertRawObservationQuery = (
  row: RawObservationRow
): SqlQuery => ({
  sql: `
    INSERT INTO raw_observations (
      id, run_id, monitor, chain_id, observed_at, kind, refs_json, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `,
  params: [
    row.id,
    row.run_id,
    row.monitor,
    row.chain_id,
    row.observed_at,
    row.kind,
    row.refs_json,
    row.data_json,
  ],
})

export const insertRawMetricQuery = (row: RawMetricRow): SqlQuery => ({
  sql: `
    INSERT INTO raw_metrics (
      run_id, monitor, chain_id, observed_at, key, value_json, unit, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `,
  params: [
    row.run_id,
    row.monitor,
    row.chain_id,
    row.observed_at,
    row.key,
    row.value_json,
    row.unit,
    row.data_json,
  ],
})

export const insertDerivedFindingQuery = (
  row: DerivedFindingRow
): SqlQuery => ({
  sql: `
    INSERT INTO derived_findings (
      id, run_id, monitor, chain_id, code, severity, title, message, observation_ids_json, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `,
  params: [
    row.id,
    row.run_id,
    row.monitor,
    row.chain_id,
    row.code,
    row.severity,
    row.title,
    row.message,
    row.observation_ids_json,
    row.data_json,
  ],
})

export const upsertLatestSnapshotQuery = (
  row: LatestSnapshotRow
): SqlQuery => ({
  sql: `
    INSERT INTO latest_snapshots (
      id, monitor, chain_id, chain_name, run_id, updated_at, status, summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      chain_name = excluded.chain_name,
      run_id = excluded.run_id,
      updated_at = excluded.updated_at,
      status = excluded.status,
      summary_json = excluded.summary_json;
  `,
  params: [
    row.id,
    row.monitor,
    row.chain_id,
    row.chain_name,
    row.run_id,
    row.updated_at,
    row.status,
    row.summary_json,
  ],
})

export const selectLatestSnapshotQuery = (
  monitor: string,
  chainId: number
): SqlQuery => ({
  sql: `
    SELECT *
    FROM latest_snapshots
    WHERE monitor = ? AND chain_id = ?;
  `,
  params: [monitor, chainId],
})

export const selectMonitorHistoryQuery = ({
  monitor,
  chainId,
  since,
  limit = 100,
}: {
  monitor: string
  chainId: number
  since: number
  limit?: number
}): SqlQuery => ({
  sql: `
    SELECT *
    FROM monitor_runs
    WHERE monitor = ? AND chain_id = ? AND finished_at >= ?
    ORDER BY finished_at DESC
    LIMIT ?;
  `,
  params: [monitor, chainId, since, limit],
})

export const selectRunDetailsQuery = (runId: string): SqlQuery => ({
  sql: `
    SELECT *
    FROM monitor_runs
    WHERE id = ?;
  `,
  params: [runId],
})
