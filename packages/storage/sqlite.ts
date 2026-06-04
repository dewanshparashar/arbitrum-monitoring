import { DatabaseSync } from 'node:sqlite'
import { MonitorRunResult, MonitorType } from 'monitor-core'
import { materializeMonitorResult } from './materialize'
import {
  insertDerivedFindingQuery,
  insertMonitorRunQuery,
  insertRawMetricQuery,
  insertRawObservationQuery,
  selectLatestSnapshotQuery,
  selectMonitorHistoryQuery,
  selectRunDetailsQuery,
  SqlQuery,
  upsertLatestSnapshotQuery,
} from './queries'
import {
  getRetentionCutoff,
  sqlitePruneStatements,
  sqliteSchemaStatements,
} from './schema'

export class SqliteMonitorStore {
  private readonly db: DatabaseSync

  constructor(location: string) {
    this.db = new DatabaseSync(location)
  }

  initialize() {
    for (const statement of sqliteSchemaStatements) {
      this.db.exec(statement)
    }
  }

  persistResult(result: MonitorRunResult) {
    const rows = materializeMonitorResult(result)

    this.db.exec('BEGIN')
    try {
      this.run(insertMonitorRunQuery(rows.run))

      for (const row of rows.observations) {
        this.run(insertRawObservationQuery(row))
      }

      for (const row of rows.metrics) {
        this.run(insertRawMetricQuery(row))
      }

      for (const row of rows.findings) {
        this.run(insertDerivedFindingQuery(row))
      }

      this.run(upsertLatestSnapshotQuery(rows.latest_snapshot))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  pruneOldRuns(now = Date.now(), retentionDays?: number) {
    const cutoff = getRetentionCutoff(now, retentionDays)

    for (const query of sqlitePruneStatements(cutoff)) {
      this.run(query)
    }

    return cutoff
  }

  readLatestSnapshot(monitor: MonitorType, chainId: number) {
    return this.get(selectLatestSnapshotQuery(monitor, chainId))
  }

  readMonitorHistory(params: {
    monitor: MonitorType
    chainId: number
    since: number
    limit?: number
  }) {
    return this.all(selectMonitorHistoryQuery(params))
  }

  readRun(runId: string) {
    return this.get(selectRunDetailsQuery(runId))
  }

  close() {
    this.db.close()
  }

  private run(query: SqlQuery) {
    this.db.prepare(query.sql).run(...query.params)
  }

  private get(query: SqlQuery) {
    return this.db.prepare(query.sql).get(...query.params)
  }

  private all(query: SqlQuery) {
    return this.db.prepare(query.sql).all(...query.params)
  }
}
