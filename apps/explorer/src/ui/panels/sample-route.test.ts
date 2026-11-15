import { describe, expect, it } from 'vitest'
import { worldToCell, type PlanGrid } from '@/core/mission/geometry'
import { pickSampleRoute } from './sample-route'

const grid: PlanGrid = { n: 100, res: 10, x0: 0, y0: 0 }

function layers(fill: (r: number, c: number) => number) {
  const slope = new Float32Array(grid.n * grid.n)
  for (let r = 0; r < grid.n; r++) for (let c = 0; c < grid.n; c++) slope[r * grid.n + c] = fill(r, c)
  return { grid, slope }
}

describe('pickSampleRoute', () => {
  it('returns two gentle cells at least minDist apart on open ground', () => {
    const s = layers(() => 3)
    const r = pickSampleRoute(s, { x: 500, z: -500 })!
    expect(Math.hypot(r.destination.x - r.origin.x, r.destination.z - r.origin.z)).toBeGreaterThanOrEqual(300)
    expect(s.slope[worldToCell(grid, r.origin.x, r.origin.z)]).toBeLessThan(12)
    expect(s.slope[worldToCell(grid, r.destination.x, r.destination.z)]).toBeLessThan(12)
  })

  it('never picks a goal behind a wall of steep cells', () => {
    // a steep wall at column 50 splits the map; the start is on the left, so the goal must be on the left too
    const s = layers((_r, c) => (c === 50 ? 40 : 3))
    const r = pickSampleRoute(s, { x: 100, z: -500 }, { minDistM: 300 })!
    expect(r.destination.x).toBeLessThan(500)
  })

  it('starts on gentle ground even when the requested point is steep', () => {
    const s = layers((r, c) => (Math.abs(r - 50) < 5 && Math.abs(c - 50) < 5 ? 35 : 3))
    const r = pickSampleRoute(s, { x: 505, z: -505 })!
    expect(s.slope[worldToCell(grid, r.origin.x, r.origin.z)]).toBeLessThan(12)
  })

  it('returns null when nothing is gentle', () => {
    expect(pickSampleRoute(layers(() => 40), { x: 500, z: -500 })).toBeNull()
  })
})
