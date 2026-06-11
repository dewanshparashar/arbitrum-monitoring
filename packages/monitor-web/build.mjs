/* Build the static fleet console into ./dist.
   - bundles src/main.jsx -> dist/app.js with esbuild (React bundled in, no
     runtime CDN dependency)
   - copies the static shell (index.html, ds.css, config.js, server.js) */

import { build } from 'esbuild'
import { mkdir, rm, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

await build({
  entryPoints: [join(root, 'src/main.jsx')],
  bundle: true,
  outfile: join(dist, 'app.js'),
  format: 'iife',
  target: 'es2020',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  loader: { '.js': 'jsx' },
  minify: true,
  sourcemap: true,
  logLevel: 'info',
})

for (const file of ['index.html', 'src/ds.css', 'config.js', 'server.js', 'og.png', 'favicon.svg', 'apple-touch-icon.png', 'llms.txt', 'robots.txt']) {
  await copyFile(join(root, file), join(dist, file.replace(/^src\//, '')))
}

console.log('monitor-web built -> dist/')
