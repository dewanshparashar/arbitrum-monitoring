import { defaultMonitorExecutors } from './defaultMonitors'
import { runWorkerLoop } from './runner'
import { createMonitorStore, inferMonitorStoreVendor } from 'storage'
import { getWorkerConfig } from './config'

export const main = async () => {
  const { config, options } = await getWorkerConfig()
  const monitors = defaultMonitorExecutors.filter(monitor =>
    options.monitors.includes(monitor.type)
  )
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
      monitors,
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
