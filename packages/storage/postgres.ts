import { Pool, PoolClient } from 'pg'
import { MonitorRunResult, MonitorType } from 'monitor-core'
import { materializeMonitorResult } from './materialize'
import {
  insertDerivedFindingQuery,
  insertMonitorRunQuery,
  insertRawMetricQuery,
  insertRawObservationQuery,
  selectLatestSnapshotQuery,
  selectLatestSnapshotsQuery,
  selectMonitorHistoryQuery,
  selectRunDetailsQuery,
  selectRunFindingsQuery,
  selectRunMetricsQuery,
  selectRunObservationsQuery,
  upsertLatestSnapshotQuery,
} from './queries'
import {
  getRetentionCutoff,
  postgresSchemaStatements,
  sqlitePruneStatements,
} from './schema'
import { MonitorHistoryParams, MonitorStore } from './store'

const toPostgresSql = (sql: string) => {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

const toPostgresQuery = (query: { sql: string; params: unknown[] }) => ({
  text: toPostgresSql(query.sql),
  values: query.params,
})

export class PostgresMonitorStore implements MonitorStore {
  private readonly pool: Pool

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString })
  }

  async initialize() {
    for (const statement of postgresSchemaStatements) {
      await this.pool.query(statement)
    }
  }

  async persistResult(result: MonitorRunResult) {
    const rows = materializeMonitorResult(result)
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      await this.run(client, insertMonitorRunQuery(rows.run))

      for (const row of rows.observations) {
        await this.run(client, insertRawObservationQuery(row))
      }

      for (const row of rows.metrics) {
        await this.run(client, insertRawMetricQuery(row))
      }

      for (const row of rows.findings) {
        await this.run(client, insertDerivedFindingQuery(row))
      }

      await this.run(client, upsertLatestSnapshotQuery(rows.latest_snapshot))
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async pruneOldRuns(now = Date.now(), retentionDays?: number) {
    const cutoff = getRetentionCutoff(now, retentionDays)

    for (const query of sqlitePruneStatements(cutoff)) {
      await this.pool.query(toPostgresQuery(query))
    }

    return cutoff
  }

  async readLatestSnapshot(monitor: MonitorType, chainId: number) {
    const result = await this.pool.query(
      toPostgresQuery(selectLatestSnapshotQuery(monitor, chainId))
    )
    return result.rows[0]
  }

  async readLatestSnapshots(monitor?: MonitorType) {
    const result = await this.pool.query(
      toPostgresQuery(selectLatestSnapshotsQuery(monitor))
    )
    return result.rows
  }

  async readMonitorHistory(params: MonitorHistoryParams) {
    const result = await this.pool.query(
      toPostgresQuery(selectMonitorHistoryQuery(params))
    )
    return result.rows
  }

  async readRun(runId: string) {
    const result = await this.pool.query(
      toPostgresQuery(selectRunDetailsQuery(runId))
    )
    return result.rows[0]
  }

  async readRunObservations(runId: string) {
    const result = await this.pool.query(
      toPostgresQuery(selectRunObservationsQuery(runId))
    )
    return result.rows
  }

  async readRunMetrics(runId: string) {
    const result = await this.pool.query(
      toPostgresQuery(selectRunMetricsQuery(runId))
    )
    return result.rows
  }

  async readRunFindings(runId: string) {
    const result = await this.pool.query(
      toPostgresQuery(selectRunFindingsQuery(runId))
    )
    return result.rows
  }

  async close() {
    await this.pool.end()
  }

  private async run(client: PoolClient, query: { sql: string; params: unknown[] }) {
    await client.query(toPostgresQuery(query))
  }
}
