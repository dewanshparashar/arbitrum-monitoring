const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const port = Number(process.env.PORT || 4020)
const root = __dirname

const send = (response, status, body, type) => {
  response.statusCode = status
  response.setHeader('content-type', type)
  response.end(body)
}

http
  .createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    const filePath = path.resolve(
      root,
      pathname === '/'
        ? path.join(root, 'index.html')
        : pathname.slice(1)
    )
    const allowedRoot = `${path.resolve(root)}${path.sep}`

    if (filePath !== path.join(root, 'index.html') && !filePath.startsWith(allowedRoot)) {
      send(response, 404, 'Not found', 'text/plain')
      return
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      send(response, 404, 'Not found', 'text/plain')
      return
    }

    const ext = path.extname(filePath)
    const type =
      ext === '.js'
        ? 'text/javascript'
        : ext === '.css'
          ? 'text/css'
          : 'text/html'

    send(response, 200, fs.readFileSync(filePath), type)
  })
  .listen(port, '0.0.0.0', () => {
    console.log(`monitor-web listening on http://0.0.0.0:${port}`)
  })
