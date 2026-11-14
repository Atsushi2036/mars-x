import { describe, expect, it } from 'vitest'
import { Heightfield } from '@/core/terrain/heightfield'
import { cellToWorld, pathStats, pathToWorld, raycastTerrain, worldToCell, type PlanGrid } from './geometry'

const grid: PlanGrid = { n: 8, res: 2, x0: -8, y0: 8 } // 16 m window centred on the origin

function plane(slopeDeg: number) {
  const n = 64
  const k = Math.tan((slopeDeg * Math.PI) / 180)
  const h = new Float32Array(n * n)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) h[r * n + c] = (c + 0.5 - 32) * k
  return new Heightfield({ width: n, height: n, res: 1, transform: [1, 0, -32, 0, -1, 32], center: { lon: 0, lat: 0 } }, h)
}

describe('plan grid mapping', () => {
  it('round-trips cell <-> world through the cell centre', () => {
    for (const idx of [0, 7, 9, 35, 63]) {
      const w = cellToWorld(grid, idx)
      expect(worldToCell(grid, w.x, w.z)).toBe(idx)
    }
  })

  it('row 0 is the NORTH edge (world z most negative) and col 0 the west edge', () => {
    const w = cellToWorld(grid, 0)
    expect(w.x).toBeCloseTo(-7)
    expect(w.z).toBeCloseTo(-7)
    const se = cellToWorld(grid, 63)
    expect(se.x).toBeCloseTo(7)
    expect(se.z).toBeCloseTo(7)
  })

  it('returns -1 outside the grid', () => {
    expect(worldToCell(grid, -8.01, 0)).toBe(-1)
    expect(worldToCell(grid, 0, 8.5)).toBe(-1)
  })

  it('pathToWorld maps every cell', () => {
    const pts = pathToWorld(grid, new Uint32Array([0, 1, 9]))
    expect(pts).toHaveLength(3)
    expect(pts[2]!.z).toBeCloseTo(-5)
  })
})

describe('raycastTerrain', () => {
  it('hits a flat plane where geometry says', () => {
    const hf = plane(0)
    const hit = raycastTerrain(hf, { x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 1 })!
    expect(hit.y).toBeCloseTo(0, 2)
    expect(hit.z).toBeCloseTo(10, 1)
  })

  it('hits an inclined plane at the right height', () => {
    const hf = plane(20)
    const hit = raycastTerrain(hf, { x: -20, y: 30, z: 0 }, { x: 0.3, y: -1, z: 0 })!
    expect(hit.y).toBeCloseTo(hf.sampleHeight(hit.x, hit.z), 2)
  })

  it('misses when looking at the sky or away from the extent', () => {
    const hf = plane(0)
    expect(raycastTerrain(hf, { x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull()
    expect(raycastTerrain(hf, { x: 0, y: 10, z: 0 }, { x: 1, y: -0.001, z: 0 })).toBeNull()
  })
})

describe('pathStats', () => {
  it('measures length, climb and slopes', () => {
    const hf = plane(10)
    const pts = [
      { x: -10, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ]
    const s = pathStats(hf, pts, () => 10)
    expect(s.lengthM).toBeCloseTo(20)
    expect(s.climbM).toBeCloseTo(20 * Math.tan((10 * Math.PI) / 180), 2)
    expect(s.maxSlopeDeg).toBe(10)
    expect(s.meanSlopeDeg).toBe(10)
  })

  it('handles an empty path', () => {
    expect(pathStats(plane(0), [], () => 0)).toEqual({ lengthM: 0, maxSlopeDeg: 0, meanSlopeDeg: 0, climbM: 0 })
  })
})
