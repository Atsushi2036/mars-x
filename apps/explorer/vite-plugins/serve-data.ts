import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.u16': 'application/octet-stream',
  '.bin': 'application/octet-stream',
}

/**
 * Dev/preview only: serves the processed dataset folder (outside the app) at /data/<name>.
 * In production the data is copied to dist/data by the build pipeline.
 */
export function serveData(mounts: Record<string, string>): Plugin {
  const handler = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const url = (req.url ?? '').split('?')[0] ?? ''
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (!url.startsWith(prefix + '/')) continue
      const rel = decodeURIComponent(url.slice(prefix.length + 1))
      const file = path.resolve(dir, rel)
      if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return next()
      }
      res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream')
      res.setHeader('Cache-Control', 'no-cache')
      fs.createReadStream(file).pipe(res)
      return
    }
    next()
  }
  return {
    name: 'marsx-serve-data',
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  }
}
