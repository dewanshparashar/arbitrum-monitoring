import yargs from 'yargs'
import { defaultMonitorExecutors } from './defaultMonitors'
import { runWorkerLoop } from './runner'
import { createMonitorStore, inferMonitorStoreVendor } from 'storage'
import { DEFAULT_CONFIG_PATH, getConfig } from 'utils'

const asBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback
  return value === 'true'
}

export const getWorkerConfig = (configPath = DEFAULT_CONFIG_PATH) => {
  const options = yargs(process.argv.slice(2))
    .options({
      configPath: {
        type: 'string',
        default: process.env.MONITOR_CONFIG_PATH || configPath,
      },
      dbPath: {
        type: 'string',
        default: process.env.MONITOR_DB_PATH || 'monitoring.sqlite',
      },
      postgresUrl: { type: 'string', default: process.env.POSTGRES_URL },
      once: {
        type: 'boolean',
        default: asBoolean(process.env.MONITOR_WORKER_ONCE, false),
      },
      pollIntervalMs: {
        type: 'number',
        default: Number(process.env.MONITOR_WORKER_POLL_INTERVAL_MS || 60 * 1000),
      },
    })
    .strict()
    .parseSync()

  return {
    config: getConfig({ configPath: options.configPath }),
    options,
  }
}

export const main = async () => {
  const { config, options } = getWorkerConfig()
  const store = createMonitorStore({
    vendor: inferMonitorStoreVendor({
      postgresUrl: options.postgresUrl,
      sqlitePath: options.dbPath,
    }),
    sqlitePath: options.dbPath,
    postgresUrl: options.postgresUrl,
  })

  await store.initialize()

  try {
    await runWorkerLoop({
      childChains: config.childChains,
      monitors: defaultMonitorExecutors,
      store,
      loop: {
        once: options.once,
        pollIntervalMs: options.pollIntervalMs,
      },
    })
  } finally {
    await store.close()
  }
}
