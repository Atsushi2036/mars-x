import { describe, expect, it } from 'vitest'
import { cellToWorld, type PlanGrid } from '@/core/mission/geometry'
import { cropBounds, learnerCellToPlanIndex, learnerCellToWorld } from './ghost-map'

const grid: PlanGrid = { n: 100, res: 2, x0: -100, y0: 100 }
// a 48x48 learning grid that covers planning cells rows 10..105 / cols 20..115 (factor 2) would overflow: use 4x4 for the test
const map = { r0: 10, c0: 20, factor: 3, cols: 4, rows: 4 }

describe('learnerCellToPlanIndex', () => {
  it('maps a learning cell to the centre of its block in the planning grid', () => {
    // learning cell (0,0) covers planning rows 10..12, cols 20..22: centre (11, 21)
    expect(learnerCellToPlanIndex(map, 100, 0)).toBe(11 * 100 + 21)
    // learning cell (row 2, col 3) = flat 2*4+3: block rows 16..18, cols 29..31, centre (17, 30)
    expect(learnerCellToPlanIndex(map, 100, 2 * 4 + 3)).toBe(17 * 100 + 30)
  })

  it('turns into world coordinates through the planning grid', () => {
    const w = learnerCellToWorld(map, grid, 0)
    const direct = cellToWorld(grid, 11 * 100 + 21)
    expect(w).toEqual(direct)
  })

  it('keeps even-sized blocks inside the block', () => {
    const m2 = { r0: 0, c0: 0, factor: 2, cols: 2, rows: 2 }
    const idx = learnerCellToPlanIndex(m2, 10, 3) // cell (1,1): rows 2..3, cols 2..3
    const r = Math.floor(idx / 10)
    const c = idx % 10
    expect(r).toBeGreaterThanOrEqual(2)
    expect(r).toBeLessThanOrEqual(3)
    expect(c).toBeGreaterThanOrEqual(2)
    expect(c).toBeLessThanOrEqual(3)
  })
})

describe('cropBounds', () => {
  it('is the box that covers the four corner cells of the learning grid in world metres', () => {
    const b = cropBounds(map, grid)
    const pts = [0, 3, 12, 15].map((c) => learnerCellToWorld(map, grid, c))
    expect(b.minX).toBe(Math.min(...pts.map((p) => p.x)))
    expect(b.maxX).toBe(Math.max(...pts.map((p) => p.x)))
    expect(b.minZ).toBe(Math.min(...pts.map((p) => p.z)))
    expect(b.maxZ).toBe(Math.max(...pts.map((p) => p.z)))
    expect(b.maxX).toBeGreaterThan(b.minX)
  })
})
