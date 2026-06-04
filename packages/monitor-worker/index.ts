import yargs from 'yargs'
import { defaultMonitorExecutors } from './defaultMonitors'
import { runWorkerLoop } from './runner'
import { createMonitorStore, inferMonitorStoreVendor } from 'storage'
import { DEFAULT_CONFIG_PATH, getConfig } from 'utils'

export const getWorkerConfig = (configPath = DEFAULT_CONFIG_PATH) => {
  const options = yargs(process.argv.slice(2))
    .options({
      configPath: { type: 'string', default: configPath },
      dbPath: { type: 'string', default: 'monitoring.sqlite' },
      postgresUrl: { type: 'string' },
      once: { type: 'boolean', default: false },
      pollIntervalMs: { type: 'number', default: 60 * 1000 },
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
