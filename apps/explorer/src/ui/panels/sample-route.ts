import { cellToWorld, worldToCell, type PlanGrid, type XZ } from '@/core/mission/geometry'

/**
 * A start and a goal for the "Use a sample route" button: both on gentle ground and connected by gentle ground
 * (8-connected flood fill over cells under `maxSlopeDeg`), so every profile can actually plan it.
 * The goal is the first cell, in path order from the start, that is at least `minDistM` away in a straight line.
 */
export function pickSampleRoute(
  layers: { grid: PlanGrid; slope: ArrayLike<number> },
  near: XZ,
  opts: { minDistM?: number; maxSlopeDeg?: number } = {},
): { origin: XZ; destination: XZ } | null {
  const { grid, slope } = layers
  const minDistM = opts.minDistM ?? 300
  const maxSlope = opts.maxSlopeDeg ?? 12
  const n = grid.n
  const ok = (i: number) => slope[i]! < maxSlope

  // nearest gentle cell to the requested position (expanding square rings)
  const c0 = worldToCell(grid, near.x, near.z)
  const r0 = c0 < 0 ? Math.floor(n / 2) : Math.floor(c0 / n)
  const col0 = c0 < 0 ? Math.floor(n / 2) : c0 - r0 * n
  let start = -1
  for (let rad = 0; rad < n && start < 0; rad++) {
    for (let dr = -rad; dr <= rad && start < 0; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue
        const r = r0 + dr
        const c = col0 + dc
        if (r < 0 || c < 0 || r >= n || c >= n) continue
        if (ok(r * n + c)) {
          start = r * n + c
          break
        }
      }
    }
  }
  if (start < 0) return null

  const origin = cellToWorld(grid, start)
  const seen = new Uint8Array(n * n)
  const queue = new Int32Array(n * n)
  let head = 0
  let tail = 0
  queue[tail++] = start
  seen[start] = 1
  while (head < tail) {
    const i = queue[head++]!
    const p = cellToWorld(grid, i)
    if (Math.hypot(p.x - origin.x, p.z - origin.z) >= minDistM) return { origin, destination: p }
    const r = Math.floor(i / n)
    const c = i - r * n
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const rr = r + dr
        const cc = c + dc
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
        const j = rr * n + cc
        if (seen[j] || !ok(j)) continue
        seen[j] = 1
        queue[tail++] = j
      }
    }
  }
  return null
}
