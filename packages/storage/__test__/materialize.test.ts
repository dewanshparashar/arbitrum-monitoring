import { describe, expect, test } from 'vitest'
import { MonitorRunResult } from 'monitor-core'
import {
  MONITOR_RETENTION_DAYS,
  createLatestSnapshotId,
  createMonitorRunId,
  getRetentionCutoff,
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
        id: 'obs-1',
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
        observation_ids_json: '["obs-1"]',
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
})
