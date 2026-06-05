import { defaultMonitorExecutors } from './defaultMonitors'
import { runWorkerLoop } from './runner'
import { createMonitorStore, inferMonitorStoreVendor } from 'storage'
import { getWorkerConfig } from './config'

export const main = async () => {
  const { config, options } = await getWorkerConfig()
  const monitors = defaultMonitorExecutors.filter(monitor =>
    options.monitors.includes(monitor.type)
  )
  console.log(
    `[worker] Starting run with store=${options.postgresUrl ? 'postgres' : 'sqlite'} once=${options.once} monitors=${monitors
      .map(monitor => monitor.type)
      .join(',')} chains=${config.childChains.length}`
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
  console.log('[worker] Store initialized')

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
    console.log('[worker] Run complete')
  } finally {
    await store.close()
    console.log('[worker] Store closed')
  }
}
