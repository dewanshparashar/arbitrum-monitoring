import { FleetDb } from '../packages/monitor-api/dist/fleetDb.js'
import { handleVercelRequest } from '../packages/monitor-api/dist/vercel.js'

const fleetDb = process.env.POSTGRES_URL
  ? new FleetDb(
      process.env.POSTGRES_URL,
      process.env.DATABASE_SCHEMA || 'public'
    )
  : undefined

export default {
  async fetch(request: Request) {
    return handleVercelRequest(request, fleetDb)
  },
}
