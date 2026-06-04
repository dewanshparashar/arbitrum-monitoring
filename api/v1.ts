import {
  createMonitorStore,
  inferMonitorStoreVendor,
} from '../packages/storage/dist'
import { handleVercelRequest } from '../packages/monitor-api/dist/vercel.js'

const store = createMonitorStore({
  vendor: inferMonitorStoreVendor({
    postgresUrl: process.env.POSTGRES_URL,
    sqlitePath: process.env.MONITOR_DB_PATH,
  }),
  postgresUrl: process.env.POSTGRES_URL,
  sqlitePath: process.env.MONITOR_DB_PATH,
})

const initializePromise = store.initialize()

export default {
  async fetch(request: Request) {
    await initializePromise
    return handleVercelRequest(request, store)
  },
}
