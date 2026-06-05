import { describe, expect, test } from 'vitest'
import { MonitorRunResult } from 'monitor-core'
import {
  MONITOR_RETENTION_DAYS,
  PostgresMonitorStore,
  SqliteMonitorStore,
  createMonitorStore,
  createLatestSnapshotId,
  createMonitorRunId,
  getRetentionCutoff,
  inferMonitorStoreVendor,
  insertMonitorRunQuery,
  materializeMonitorResult,
  selectMonitorHistoryQuery,
  sqlitePruneStatements,
  upsertLatestSnapshotQuery,
} from '..'

describe('materializeMonitorResult', () => {
  test('flattens a monitor result into storage rows', () => {
    const result: MonitorRunResult = {
      monitor: 'assertion',
      chainId: 42161,
      chainName: 'Arbitrum One',
      startedAt: 10,
      finishedAt: 20,
      status: 'partial',
      observations: [
        {
          id: 'obs-1',
          monitor: 'assertion',
          chainId: 42161,
          observedAt: 20,
          kind: 'assertion-window',
          refs: {
            blocks: [
              {
                chainId: 1,
                number: 123n,
              },
            ],
          },
          data: {
            fromBlock: 100,
            toBlock: 200,
          },
        },
      ],
      metrics: [
        {
          key: 'assertions_missing',
          monitor: 'assertion',
          chainId: 42161,
          observedAt: 20,
          value: 2,
        },
      ],
      findings: [
        {
          code: 'assertions_missing',
          monitor: 'assertion',
          chainId: 42161,
          severity: 'critical',
          title: 'Assertions missing',
          message: 'No recent assertions found.',
          observationIds: ['obs-1'],
        },
      ],
      meta: {
        parentChainId: 1,
      },
    }

    const rows = materializeMonitorResult(result)

    expect(rows.run).toEqual({
      id: createMonitorRunId(result),
      monitor: 'assertion',
      chain_id: 42161,
      chain_name: 'Arbitrum One',
      started_at: 10,
      finished_at: 20,
      status: 'partial',
      error: null,
      meta_json: '{"parentChainId":1}',
    })

    expect(rows.observations).toEqual([
      {
        id: `${createMonitorRunId(result)}:observation:obs-1`,
        run_id: createMonitorRunId(result),
        monitor: 'assertion',
        chain_id: 42161,
        observed_at: 20,
        kind: 'assertion-window',
        refs_json: '{"blocks":[{"chainId":1,"number":"123"}]}',
        data_json: '{"fromBlock":100,"toBlock":200}',
      },
    ])

    expect(rows.metrics).toEqual([
      {
        run_id: createMonitorRunId(result),
        monitor: 'assertion',
        chain_id: 42161,
        observed_at: 20,
        key: 'assertions_missing',
        value_json: '2',
        unit: null,
        data_json: null,
      },
    ])

    expect(rows.findings).toEqual([
      {
        id: `${createMonitorRunId(result)}:finding:0`,
        run_id: createMonitorRunId(result),
        monitor: 'assertion',
        chain_id: 42161,
        code: 'assertions_missing',
        severity: 'critical',
        title: 'Assertions missing',
        message: 'No recent assertions found.',
        observation_ids_json: `["${createMonitorRunId(
          result
        )}:observation:obs-1"]`,
        data_json: null,
      },
    ])

    expect(rows.latest_snapshot).toEqual({
      id: createLatestSnapshotId('assertion', 42161),
      monitor: 'assertion',
      chain_id: 42161,
      chain_name: 'Arbitrum One',
      run_id: createMonitorRunId(result),
      updated_at: 20,
      status: 'partial',
      summary_json:
        '{"metric_values":{"assertions_missing":2},"finding_counts":{"info":0,"warning":0,"critical":1}}',
    })
  })

  test('returns the default retention cutoff and prune statement', () => {
    const cutoff = getRetentionCutoff(14 * 24 * 60 * 60 * 1000)

    expect(cutoff).toBe(0)
    expect(MONITOR_RETENTION_DAYS).toBe(14)
    expect(sqlitePruneStatements(123)).toEqual([
      {
        sql: 'DELETE FROM monitor_runs WHERE finished_at < ?;',
        params: [123],
      },
    ])
  })

  test('builds insert and read queries from materialized rows', () => {
    const result: MonitorRunResult = {
      monitor: 'retryable',
      chainId: 421614,
      chainName: 'Orbit Test',
      startedAt: 1,
      finishedAt: 2,
      status: 'ok',
      observations: [],
      metrics: [],
      findings: [],
    }

    const rows = materializeMonitorResult(result)

    expect(insertMonitorRunQuery(rows.run).params).toEqual([
      rows.run.id,
      'retryable',
      421614,
      'Orbit Test',
      1,
      2,
      'ok',
      null,
      null,
    ])
    expect(upsertLatestSnapshotQuery(rows.latest_snapshot).params).toEqual([
      'retryable:421614',
      'retryable',
      421614,
      'Orbit Test',
      'retryable:421614:1:2',
      2,
      'ok',
      '{"metric_values":{},"finding_counts":{"info":0,"warning":0,"critical":0}}',
    ])
    expect(
      selectMonitorHistoryQuery({
        monitor: 'retryable',
        chainId: 421614,
        since: 0,
        limit: 14,
      }).params
    ).toEqual(['retryable', 421614, 0, 14])
  })

  test('supports large orbit chain ids in storage rows', () => {
    const result: MonitorRunResult = {
      monitor: 'batch-poster',
      chainId: 37714555429,
      chainName: 'Xai Testnet',
      startedAt: 1,
      finishedAt: 2,
      status: 'ok',
      observations: [],
      metrics: [],
      findings: [],
    }

    const rows = materializeMonitorResult(result)

    expect(rows.run.chain_id).toBe(37714555429)
    expect(insertMonitorRunQuery(rows.run).params[2]).toBe(37714555429)
    expect(upsertLatestSnapshotQuery(rows.latest_snapshot).params[2]).toBe(
      37714555429
    )
  })

  test('namespaces repeated observation ids by run', () => {
    const firstResult: MonitorRunResult = {
      monitor: 'batch-poster',
      chainId: 660279,
      chainName: 'Xai',
      startedAt: 1,
      finishedAt: 2,
      status: 'ok',
      observations: [
        {
          id: 'batch-poster-config:660279:0xabc',
          monitor: 'batch-poster',
          chainId: 660279,
          observedAt: 2,
          kind: 'batch-poster-config',
          data: {},
        },
      ],
      metrics: [],
      findings: [],
    }
    const secondResult: MonitorRunResult = {
      ...firstResult,
      startedAt: 3,
      finishedAt: 4,
    }

    const firstRows = materializeMonitorResult(firstResult)
    const secondRows = materializeMonitorResult(secondResult)

    expect(firstRows.observations[0].id).toBe(
      'batch-poster:660279:1:2:observation:batch-poster-config:660279:0xabc'
    )
    expect(secondRows.observations[0].id).toBe(
      'batch-poster:660279:3:4:observation:batch-poster-config:660279:0xabc'
    )
  })

  test('persists and reads monitor rows through sqlite', () => {
    const store = new SqliteMonitorStore(':memory:')
    const result: MonitorRunResult = {
      monitor: 'batch-poster',
      chainId: 42170,
      chainName: 'Arbitrum Nova',
      startedAt: 100,
      finishedAt: 200,
      status: 'ok',
      observations: [],
      metrics: [],
      findings: [],
    }

    store.initialize()
    store.persistResult(result)

    expect(store.readRun(createMonitorRunId(result))).toMatchObject({
      id: createMonitorRunId(result),
      monitor: 'batch-poster',
      chain_id: 42170,
      chain_name: 'Arbitrum Nova',
    })
    expect(store.readLatestSnapshot('batch-poster', 42170)).toMatchObject({
      id: createLatestSnapshotId('batch-poster', 42170),
      run_id: createMonitorRunId(result),
      status: 'ok',
    })
    expect(
      store.readMonitorHistory({
        monitor: 'batch-poster',
        chainId: 42170,
        since: 0,
      })
    ).toHaveLength(1)

    store.close()
  })

  test('creates the right store vendor from config hints', async () => {
    const sqliteStore = createMonitorStore({
      vendor: inferMonitorStoreVendor({ sqlitePath: 'monitoring.sqlite' }),
      sqlitePath: 'monitoring.sqlite',
    })
    const postgresStore = createMonitorStore({
      vendor: inferMonitorStoreVendor({
        postgresUrl: 'postgresql://postgres:postgres@localhost:5432/monitoring',
      }),
      postgresUrl: 'postgresql://postgres:postgres@localhost:5432/monitoring',
    })

    expect(inferMonitorStoreVendor({ sqlitePath: 'monitoring.sqlite' })).toBe(
      'sqlite'
    )
    expect(
      inferMonitorStoreVendor({
        postgresUrl: 'postgresql://postgres:postgres@localhost:5432/monitoring',
      })
    ).toBe('postgres')
    expect(sqliteStore).toBeInstanceOf(SqliteMonitorStore)
    expect(postgresStore).toBeInstanceOf(PostgresMonitorStore)

    await postgresStore.close()
  })
})
