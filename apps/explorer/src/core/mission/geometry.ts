/**
 * Pure mission geometry: planning-grid cell <-> world, terrain ray casting for clicks, path statistics.
 * The planning grid is coarser (2 m) than the render grid (1 m); both share the same extent, so the
 * conversion only needs the grid transform.
 */
import type { Heightfield } from '@/core/terrain/heightfield'

export interface PlanGrid {
  n: number
  res: number
  /** world X of the upper-left corner */
  x0: number
  /** local northing of the upper-left corner (world z = -y0 at row 0) */
  y0: number
}

export interface XZ {
  x: number
  z: number
}

/** World -> flat cell index (row * n + col), or -1 when outside the grid. */
export function worldToCell(g: PlanGrid, x: number, z: number): number {
  const col = Math.floor((x - g.x0) / g.res)
  const row = Math.floor((z + g.y0) / g.res)
  if (col < 0 || row < 0 || col >= g.n || row >= g.n) return -1
  return row * g.n + col
}

/** Centre of a cell in world metres. */
export function cellToWorld(g: PlanGrid, index: number): XZ {
  const row = Math.floor(index / g.n)
  const col = index - row * g.n
  return { x: g.x0 + (col + 0.5) * g.res, z: -g.y0 + (row + 0.5) * g.res }
}

export function pathToWorld(g: PlanGrid, path: ArrayLike<number>): XZ[] {
  const out: XZ[] = new Array(path.length)
  for (let i = 0; i < path.length; i++) out[i] = cellToWorld(g, path[i]!)
  return out
}

/**
 * Ray / terrain intersection by marching the ray and refining with bisection. Cheap enough to run on a
 * click (never per frame). Returns null when the ray misses the terrain extent.
 */
export function raycastTerrain(
  hf: Heightfield,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist = 8000,
): { x: number; y: number; z: number } | null {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len }
  const at = (t: number) => ({ x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t })
  const above = (t: number) => {
    const p = at(t)
    return p.y - hf.sampleHeight(p.x, p.z)
  }
  let t = 0
  let step = Math.max(1, hf.res)
  if (above(0) < 0) return null // camera below the surface
  while (t < maxDist) {
    const prev = t
    t += step
    const p = at(t)
    if (hf.inBounds(p.x, p.z) && above(t) <= 0) {
      let lo = prev
      let hi = t
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2
        if (above(mid) > 0) lo = mid
        else hi = mid
      }
      const hit = at(hi)
      return { x: hit.x, y: hf.sampleHeight(hit.x, hit.z), z: hit.z }
    }
    step = Math.min(8, step * 1.04) // coarser far away, still sub-feature for 1 m data
  }
  return null
}

export interface PathStats {
  lengthM: number
  maxSlopeDeg: number
  meanSlopeDeg: number
  climbM: number
}

/** Statistics of a world-space path over the render heightfield and the planning slope grid. */
export function pathStats(hf: Heightfield, pts: XZ[], slopeAt: (x: number, z: number) => number): PathStats {
  let length = 0
  let climb = 0
  let max = 0
  let sum = 0
  let prevH = pts.length ? hf.sampleHeight(pts[0]!.x, pts[0]!.z) : 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const s = slopeAt(p.x, p.z)
    if (s > max) max = s
    sum += s
    if (i > 0) {
      const q = pts[i - 1]!
      length += Math.hypot(p.x - q.x, p.z - q.z)
      const h = hf.sampleHeight(p.x, p.z)
      if (h > prevH) climb += h - prevH
      prevH = h
    }
  }
  return { lengthM: length, maxSlopeDeg: max, meanSlopeDeg: pts.length ? sum / pts.length : 0, climbM: climb }
}
