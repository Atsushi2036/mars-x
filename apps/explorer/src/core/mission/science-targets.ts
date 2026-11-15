import type { Dataset } from '@/core/data/loader'
import { parseWaypoints } from '@/scene/traverse-data'
import type { WaypointInfo } from '@/store/app'

/**
 * Candidate destinations for a Marswalk: every recorded Perseverance waypoint inside the window (real
 * positions with the sol and the rover's measured tilt) and the largest CRISM patch of a few minerals the
 * mission cares about (the CRISM map is an ML-derived product).
 */
export interface ScienceTarget {
  id: string
  kind: 'waypoint' | 'mineral'
  label: string
  /** one short line under the label */
  detail: string
  x: number
  z: number
  waypoint?: WaypointInfo
}

export function waypointId(w: WaypointInfo, taken: Set<string>): string {
  const base = `wp-${w.sol}-${w.site}-${w.drive}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

export function waypointTargets(waypoints: WaypointInfo[]): ScienceTarget[] {
  const taken = new Set<string>()
  return waypoints.map((w) => ({
    id: waypointId(w, taken),
    kind: 'waypoint' as const,
    label: `Sol ${w.sol}, site ${w.site}`,
    detail: `Measured tilt ${w.tiltDeg.toFixed(1).replace('-', '−')}°`,
    x: w.x,
    z: w.z,
    waypoint: w,
  }))
}

export interface Patch {
  /** pixel of the patch closest to its centroid (always inside the patch) */
  col: number
  row: number
  size: number
}

/** Largest 4-connected patch of pixels with exactly this colour and opaque alpha; null when there is none. */
export function largestPatch(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, rgb: [number, number, number]): Patch | null {
  const match = (i: number) => rgba[4 * i] === rgb[0] && rgba[4 * i + 1] === rgb[1] && rgba[4 * i + 2] === rgb[2] && rgba[4 * i + 3]! > 127
  const seen = new Uint8Array(w * h)
  let best: { cells: number[] } | null = null
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !match(s)) continue
    const cells: number[] = []
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const i = stack.pop()!
      cells.push(i)
      const c = i % w
      const r = (i - c) / w
      const nb = [c > 0 ? i - 1 : -1, c < w - 1 ? i + 1 : -1, r > 0 ? i - w : -1, r < h - 1 ? i + w : -1]
      for (const j of nb) {
        if (j >= 0 && !seen[j] && match(j)) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    if (!best || cells.length > best.cells.length) best = { cells }
  }
  if (!best) return null
  let sc = 0
  let sr = 0
  for (const i of best.cells) {
    sc += i % w
    sr += Math.floor(i / w)
  }
  const mc = sc / best.cells.length
  const mr = sr / best.cells.length
  let pick = best.cells[0]!
  let d2 = Infinity
  for (const i of best.cells) {
    const d = (i % w - mc) ** 2 + (Math.floor(i / w) - mr) ** 2
    if (d < d2) {
      d2 = d
      pick = i
    }
  }
  return { col: pick % w, row: Math.floor(pick / w), size: best.cells.length }
}

const MINERALS: Array<{ match: RegExp; label: string }> = [
  { match: /^Mg-carbonate \(high/i, label: 'Mg-carbonate patch' },
  { match: /^Fe\/Mg-smectite/i, label: 'Fe/Mg-smectite patch' },
  { match: /^Olivine \(high/i, label: 'Olivine patch' },
]

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

async function mineralTargets(ds: Dataset): Promise<ScienceTarget[]> {
  const layer = ds.manifest.layers.find((l) => l.id === 'crism')
  const grid = layer?.gridId ? ds.manifest.grids[layer.gridId] : undefined
  if (!layer || !grid || !layer.legend) return []
  const res = await fetch(`${ds.base}/${layer.path}`)
  if (!res.ok) return []
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(bmp, 0, 0)
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  const out: ScienceTarget[] = []
  for (const m of MINERALS) {
    const item = layer.legend.find((l) => m.match.test(l.label) && (l.pixels ?? 0) > 0)
    const rgb = item ? hexToRgb(item.color) : null
    if (!item || !rgb) continue
    const p = largestPatch(px, bmp.width, bmp.height, rgb)
    if (!p) continue
    // grid transform: x = c + a*col, z = -(f + e*row), row 0 is north
    const x = grid.transform[2] + (p.col + 0.5) * grid.resM
    const z = -(grid.transform[5] - (p.row + 0.5) * grid.resM)
    out.push({
      id: `mineral-${m.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`,
      kind: 'mineral',
      label: m.label,
      detail: `CRISM, ${item.label}; ML-derived map, ${Math.round(p.size * grid.resM * grid.resM).toLocaleString('en-US')} m² patch`,
      x,
      z,
    })
  }
  return out
}

/** Loads the waypoints and the mineral patches of a dataset. Missing files simply yield fewer targets. */
export async function loadScienceTargets(ds: Dataset): Promise<ScienceTarget[]> {
  const wpLayer = ds.manifest.layers.find((l) => l.id === 'waypoints')
  const out: ScienceTarget[] = []
  try {
    if (wpLayer) {
      const res = await fetch(`${ds.base}/${wpLayer.path}`)
      if (res.ok) out.push(...waypointTargets(parseWaypoints(await res.json())))
    }
  } catch (e) {
    console.warn('waypoints unavailable', e)
  }
  try {
    out.unshift(...(await mineralTargets(ds)))
  } catch (e) {
    console.warn('mineral targets unavailable', e)
  }
  return out
}
