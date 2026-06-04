import { MonitorRunStatus, MonitorType, MonitorValue } from 'monitor-core'

export const MONITOR_RETENTION_DAYS = 14
export const MONITOR_STORAGE_SCHEMA_VERSION = 1

export interface MonitorRunRow {
  id: string
  monitor: MonitorType
  chain_id: number
  chain_name: string
  started_at: number
  finished_at: number
  status: MonitorRunStatus
  error: string | null
  meta_json: string | null
}

export interface RawObservationRow {
  id: string
  run_id: string
  monitor: MonitorType
  chain_id: number
  observed_at: number
  kind: string
  refs_json: string | null
  data_json: string
}

export interface RawMetricRow {
  run_id: string
  monitor: MonitorType
  chain_id: number
  observed_at: number
  key: string
  value_json: string
  unit: string | null
  data_json: string | null
}

export interface DerivedFindingRow {
  id: string
  run_id: string
  monitor: MonitorType
  chain_id: number
  code: string
  severity: string
  title: string
  message: string
  observation_ids_json: string | null
  data_json: string | null
}

export interface LatestSnapshotSummary {
  metric_values: Record<string, MonitorValue>
  finding_counts: {
    info: number
    warning: number
    critical: number
  }
}

export interface LatestSnapshotRow {
  id: string
  monitor: MonitorType
  chain_id: number
  chain_name: string
  run_id: string
  updated_at: number
  status: MonitorRunStatus
  summary_json: string
}

export interface MonitorResultRows {
  run: MonitorRunRow
  observations: RawObservationRow[]
  metrics: RawMetricRow[]
  findings: DerivedFindingRow[]
  latest_snapshot: LatestSnapshotRow
}

export const sqliteSchemaStatements = [
  'PRAGMA foreign_keys = ON;',
  'PRAGMA journal_mode = WAL;',
  `
  CREATE TABLE IF NOT EXISTS monitor_runs (
    id TEXT PRIMARY KEY,
    monitor TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    chain_name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    meta_json TEXT
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS raw_observations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    monitor TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    refs_json TEXT,
    data_json TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES monitor_runs(id) ON DELETE CASCADE
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS raw_metrics (
    run_id TEXT NOT NULL,
    monitor TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    unit TEXT,
    data_json TEXT,
    PRIMARY KEY (run_id, key, observed_at),
    FOREIGN KEY (run_id) REFERENCES monitor_runs(id) ON DELETE CASCADE
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS derived_findings (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    monitor TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    observation_ids_json TEXT,
    data_json TEXT,
    FOREIGN KEY (run_id) REFERENCES monitor_runs(id) ON DELETE CASCADE
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS latest_snapshots (
    id TEXT PRIMARY KEY,
    monitor TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    chain_name TEXT NOT NULL,
    run_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    summary_json TEXT NOT NULL
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS monitor_runs_chain_monitor_finished_at_idx
  ON monitor_runs (chain_id, monitor, finished_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS raw_observations_run_id_idx
  ON raw_observations (run_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS raw_metrics_run_id_idx
  ON raw_metrics (run_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS derived_findings_run_id_idx
  ON derived_findings (run_id);
  `,
]

export const postgresSchemaStatements = [
  `
  CREATE TABLE IF NOT EXISTS monitor_runs (
    id TEXT PRIMARY KEY,
    monitor TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    chain_name TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    finished_at BIGINT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    meta_json TEXT
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS raw_observations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
    monitor TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    observed_at BIGINT NOT NULL,
    kind TEXT NOT NULL,
    refs_json TEXT,
    data_json TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS raw_metrics (
    run_id TEXT NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
    monitor TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    observed_at BIGINT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    unit TEXT,
    data_json TEXT,
    PRIMARY KEY (run_id, key, observed_at)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS derived_findings (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
    monitor TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    code TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    observation_ids_json TEXT,
    data_json TEXT
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS latest_snapshots (
    id TEXT PRIMARY KEY,
    monitor TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    chain_name TEXT NOT NULL,
    run_id TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    status TEXT NOT NULL,
    summary_json TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE monitor_runs
  ALTER COLUMN chain_id TYPE BIGINT;
  `,
  `
  ALTER TABLE raw_observations
  ALTER COLUMN chain_id TYPE BIGINT;
  `,
  `
  ALTER TABLE raw_metrics
  ALTER COLUMN chain_id TYPE BIGINT;
  `,
  `
  ALTER TABLE derived_findings
  ALTER COLUMN chain_id TYPE BIGINT;
  `,
  `
  ALTER TABLE latest_snapshots
  ALTER COLUMN chain_id TYPE BIGINT;
  `,
  `
  CREATE INDEX IF NOT EXISTS monitor_runs_chain_monitor_finished_at_idx
  ON monitor_runs (chain_id, monitor, finished_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS raw_observations_run_id_idx
  ON raw_observations (run_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS raw_metrics_run_id_idx
  ON raw_metrics (run_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS derived_findings_run_id_idx
  ON derived_findings (run_id);
  `,
]

export const getRetentionCutoff = (
  now = Date.now(),
  retentionDays = MONITOR_RETENTION_DAYS
) => now - retentionDays * 24 * 60 * 60 * 1000

export const sqlitePruneStatements = (cutoff: number) => [
  {
    sql: 'DELETE FROM monitor_runs WHERE finished_at < ?;',
    params: [cutoff],
  },
]
