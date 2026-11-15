import { describe, expect, it } from 'vitest'
import { miniFrame, miniToWorld, worldToMini, coneWedge } from './minimap-math'

const EXT = { xMin: -1000, xMax: 1000, zMin: -1000, zMax: 1000 }

describe('minimap math', () => {
  const fr = miniFrame(EXT, 168)
  it('maps the tile centre to the middle of the canvas and corners to corners (north up: z south = down)', () => {
    expect(worldToMini(0, 0, fr)).toEqual({ x: 84, y: 84 })
    expect(worldToMini(-1000, -1000, fr)).toEqual({ x: 0, y: 0 })
    expect(worldToMini(1000, 1000, fr)).toEqual({ x: 168, y: 168 })
  })
  it('pixel to world inverts it within 5 m for a known pixel', () => {
    const p = worldToMini(312, -457, fr)
    const w = miniToWorld(p.x, p.y, fr, EXT)
    expect(Math.abs(w.x - 312)).toBeLessThan(5)
    expect(Math.abs(w.z + 457)).toBeLessThan(5)
  })
  it('clicks outside the canvas are clamped into the tile', () => {
    const w = miniToWorld(-50, 999, fr, EXT)
    expect(w.x).toBe(-1000)
    expect(w.z).toBe(1000)
  })
  it('letterboxes a non-square tile', () => {
    const f = miniFrame({ xMin: -2000, xMax: 2000, zMin: -1000, zMax: 1000 }, 200)
    expect(worldToMini(0, 0, f)).toEqual({ x: 100, y: 100 })
    expect(worldToMini(2000, 1000, f).x).toBe(200)
    expect(worldToMini(2000, 1000, f).y).toBe(150)
  })
  it('the camera cone points where the camera looks (north = up on the map)', () => {
    const w = coneWedge({ x: 50, y: 50 }, 0, 55, 30)
    expect(w.left.y).toBeLessThan(50)
    expect(w.right.y).toBeLessThan(50)
    const e = coneWedge({ x: 50, y: 50 }, -Math.PI / 2, 55, 30) // looking east
    expect(e.left.x).toBeGreaterThan(50)
  })
})
