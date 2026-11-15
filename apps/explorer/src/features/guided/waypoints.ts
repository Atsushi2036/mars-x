import { parseWaypoints } from '@/scene/traverse-data'
import type { WaypointInfo } from '@/store/app'
import type { Dataset } from '@/core/data/loader'

const cache = new Map<string, Promise<WaypointInfo[]>>()

/** The recorded Perseverance waypoints clipped to the terrain window (same file the traverse layer reads). */
export function loadWaypoints(ds: Dataset): Promise<WaypointInfo[]> {
  let p = cache.get(ds.base)
  if (!p) {
    const w = ds.manifest.layers.find((l) => l.id === 'waypoints')
    p = w
      ? fetch(`${ds.base}/${w.path}`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json().then(parseWaypoints)
        })
      : Promise.resolve([])
    p.catch(() => cache.delete(ds.base))
    cache.set(ds.base, p)
  }
  return p
}
