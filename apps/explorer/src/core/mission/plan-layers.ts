import type { Dataset } from '@/core/data/loader'
import type { Layer } from '@/core/data/manifest'
import type { PlanGrid } from './geometry'

export interface PlanLayers {
  grid: PlanGrid
  /** slope in degrees per planning cell; impassable/unknown cells are 90 */
  slope: Float32Array
  /** roughness in metres per planning cell */
  rough: Float32Array
  /** where the numbers came from, shown in the UI */
  origin: 'pipeline' | 'derived-from-elevation'
}

async function fetchU8(url: string, expected: number, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length !== expected) throw new Error(`${url}: expected ${expected} bytes, got ${buf.length}`)
  return buf
}

function decodeU8(raw: Uint8Array, layer: Layer, fallbackNodata: number): Float32Array {
  const scale = layer.encoding.scale ?? 1
  const offset = layer.encoding.offset ?? 0
  const nodata = layer.encoding.nodata ?? 255
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] === nodata ? fallbackNodata : raw[i]! * scale + offset
  return out
}

/** Loads the planning-grid slope/roughness published by the pipeline; derives them from elevation if absent (synthetic data). */
export async function loadPlanLayers(ds: Dataset, signal?: AbortSignal): Promise<PlanLayers> {
  const m = ds.manifest
  const slopeL = m.layers.find((l) => l.id === 'plan_slope')
  const roughL = m.layers.find((l) => l.id === 'plan_roughness')
  if (slopeL && roughL) {
    const g = slopeL.gridId ? m.grids[slopeL.gridId] : undefined
    if (!g || g.width !== g.height) throw new Error('Planning grid must be square')
    const n = g.width
    const [s, r] = await Promise.all([
      fetchU8(`${ds.base}/${slopeL.path}`, n * n, signal),
      fetchU8(`${ds.base}/${roughL.path}`, n * n, signal),
    ])
    return {
      grid: { n, res: g.resM, x0: g.transform[2], y0: g.transform[5] },
      slope: decodeU8(s, slopeL, 90),
      rough: decodeU8(r, roughL, 1),
      origin: 'pipeline',
    }
  }
  return derivePlanLayers(ds)
}

export function derivePlanLayers(ds: Dataset): PlanLayers {
  const hf = ds.heightfield
  const res = 2
  const n = Math.floor(Math.min(hf.width, hf.height) / res)
  const slope = new Float32Array(n * n)
  const rough = new Float32Array(n * n)
  const g: PlanGrid = { n, res, x0: hf.x0, y0: hf.y0 }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = g.x0 + (c + 0.5) * res
      const z = -g.y0 + (r + 0.5) * res
      slope[r * n + c] = hf.slopeDegAt(x, z)
    }
  }
  return { grid: g, slope, rough, origin: 'derived-from-elevation' }
}
