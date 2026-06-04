import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import yargs from 'yargs'
import {
  createMonitorStore,
  inferMonitorStoreVendor,
  MonitorStore,
} from 'storage'
import { handleApiRequest } from './routes'

export const getApiConfig = () =>
  yargs(process.argv.slice(2))
    .options({
      host: { type: 'string', default: process.env.MONITOR_API_HOST || '0.0.0.0' },
      port: {
        type: 'number',
        default: Number(process.env.MONITOR_API_PORT || 4010),
      },
      dbPath: {
        type: 'string',
        default: process.env.MONITOR_DB_PATH || 'monitoring.sqlite',
      },
      postgresUrl: { type: 'string', default: process.env.POSTGRES_URL },
      corsOrigin: {
        type: 'string',
        default: process.env.MONITOR_API_CORS_ORIGIN || '*',
      },
    })
    .strict()
    .parseSync()

const writeJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
  corsOrigin: string
) => {
  response.statusCode = status
  response.setHeader('access-control-allow-origin', corsOrigin)
  response.setHeader('access-control-allow-methods', 'GET,OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

export const createApiServer = (store: MonitorStore, corsOrigin = '*') =>
  createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'OPTIONS') {
      writeJson(response, 200, { ok: true }, corsOrigin)
      return
    }

    const url = new URL(request.url || '/', 'http://localhost')
    const apiResponse = await handleApiRequest({
      method: request.method || 'GET',
      pathname: url.pathname,
      searchParams: url.searchParams,
      store,
    })

    writeJson(response, apiResponse.status, apiResponse.body, corsOrigin)
  })

export const main = async () => {
  const options = getApiConfig()
  const store = createMonitorStore({
    vendor: inferMonitorStoreVendor({
      postgresUrl: options.postgresUrl,
      sqlitePath: options.dbPath,
    }),
    sqlitePath: options.dbPath,
    postgresUrl: options.postgresUrl,
  })

  await store.initialize()
  const server = createApiServer(store, options.corsOrigin)

  server.listen(options.port, options.host, () => {
    console.log(`monitor-api listening on http://${options.host}:${options.port}`)
  })

  const close = async () => {
    server.close()
    await store.close()
  }

  process.on('SIGINT', () => {
    close().then(() => process.exit(0))
  })

  process.on('SIGTERM', () => {
    close().then(() => process.exit(0))
  })
}
