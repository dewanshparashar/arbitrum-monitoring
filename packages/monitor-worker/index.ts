import yargs from 'yargs'
import { defaultMonitorExecutors } from './defaultMonitors'
import { runWorkerLoop } from './runner'
import { SqliteMonitorStore } from 'storage'
import { DEFAULT_CONFIG_PATH, getConfig } from 'utils'

export const getWorkerConfig = (configPath = DEFAULT_CONFIG_PATH) => {
  const options = yargs(process.argv.slice(2))
    .options({
      configPath: { type: 'string', default: configPath },
      dbPath: { type: 'string', default: 'monitoring.sqlite' },
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
  const store = new SqliteMonitorStore(options.dbPath)

  store.initialize()

  await runWorkerLoop({
    childChains: config.childChains,
    monitors: defaultMonitorExecutors,
    store,
    loop: {
      once: options.once,
      pollIntervalMs: options.pollIntervalMs,
    },
  })
}
