import type { Dataset } from '@/core/data/loader'
import type { Layer } from '@/core/data/manifest'
import type { Terrain } from '@/intelligence'

/**
 * Planning-grid terrain for env-lite (same layers the Python environment reads: plan_slope, plan_step,
 * plan_height). Nodata becomes NaN, which env-lite treats as blocked, exactly like python.
 */
const layer = (ds: Dataset, id: string): Layer => {
  const l = ds.manifest.layers.find((x) => x.id === id)
  if (!l) throw new Error(`The dataset has no ${id} layer`)
  return l
}

async function bytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.arrayBuffer()
}

export function decodeLayer(buf: ArrayBuffer, enc: Layer['encoding']): Float32Array {
  const scale = enc.scale ?? 1
  const offset = enc.offset ?? 0
  const nodata = enc.nodata ?? null
  const raw = enc.dtype === 'uint16' ? new Uint16Array(buf) : new Uint8Array(buf)
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = nodata !== null && raw[i] === nodata ? Number.NaN : raw[i]! * scale + offset
  return out
}

let cache: { ds: Dataset; terrain: Promise<Terrain> } | null = null

export function loadSimTerrain(ds: Dataset, signal?: AbortSignal): Promise<Terrain> {
  if (cache?.ds === ds) return cache.terrain
  const slope = layer(ds, 'plan_slope')
  const step = layer(ds, 'plan_step')
  const height = layer(ds, 'plan_height')
  const grid = slope.gridId ? ds.manifest.grids[slope.gridId] : undefined
  if (!grid) throw new Error('The planning grid is missing from the manifest')
  const terrain = Promise.all([slope, step, height].map((l) => bytes(`${ds.base}/${l.path}`, signal))).then(([s, st, h]) => {
    const n = grid.width * grid.height
    const t: Terrain = { rows: grid.height, cols: grid.width, resM: grid.resM, slope: decodeLayer(s!, slope.encoding), step: decodeLayer(st!, step.encoding), height: decodeLayer(h!, height.encoding) }
    if (t.slope.length !== n || t.step.length !== n || t.height.length !== n) throw new Error('The planning layers do not match the grid size')
    return t
  })
  cache = { ds, terrain }
  terrain.catch(() => {
    if (cache?.terrain === terrain) cache = null
  })
  return terrain
}
