import { Hono } from 'hono'

const app = new Hono()

app.get('/', c => {
  return c.json({ ok: true, service: 'monitor-indexer' })
})

export default app
