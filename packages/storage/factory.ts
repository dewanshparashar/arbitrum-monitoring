import { PostgresMonitorStore } from './postgres'
import { SqliteMonitorStore } from './sqlite'
import { MonitorStore } from './store'

export type MonitorStoreVendor = 'sqlite' | 'postgres'

export interface CreateMonitorStoreOptions {
  vendor: MonitorStoreVendor
  sqlitePath?: string
  postgresUrl?: string
}

export const createMonitorStore = ({
  vendor,
  sqlitePath,
  postgresUrl,
}: CreateMonitorStoreOptions): MonitorStore => {
  if (vendor === 'postgres') {
    if (!postgresUrl) {
      throw new Error('postgresUrl is required when vendor is postgres')
    }

    return new PostgresMonitorStore(postgresUrl)
  }

  return new SqliteMonitorStore(sqlitePath || 'monitoring.sqlite')
}

export const inferMonitorStoreVendor = ({
  postgresUrl,
  sqlitePath,
}: {
  postgresUrl?: string
  sqlitePath?: string
}): MonitorStoreVendor => {
  if (postgresUrl) {
    return 'postgres'
  }

  if (sqlitePath) {
    return 'sqlite'
  }

  return 'sqlite'
}
