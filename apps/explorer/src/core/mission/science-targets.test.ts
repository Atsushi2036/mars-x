import { describe, expect, it } from 'vitest'
import { largestPatch, waypointId, waypointTargets } from './science-targets'
import type { WaypointInfo } from '@/store/app'

function image(w: number, h: number, paint: Array<[number, number, [number, number, number]]>) {
  const a = new Uint8ClampedArray(w * h * 4)
  for (const [c, r, rgb] of paint) {
    const i = 4 * (r * w + c)
    a[i] = rgb[0]
    a[i + 1] = rgb[1]
    a[i + 2] = rgb[2]
    a[i + 3] = 255
  }
  return a
}

describe('largestPatch', () => {
  const G: [number, number, number] = [0, 255, 0]
  it('picks the biggest 4-connected patch and a pixel inside it', () => {
    const paint: Array<[number, number, [number, number, number]]> = [[0, 0, G]] // single pixel
    for (let c = 4; c < 8; c++) for (let r = 4; r < 7; r++) paint.push([c, r, G]) // 12 pixels
    const p = largestPatch(image(10, 10, paint), 10, 10, G)
    expect(p?.size).toBe(12)
    expect(p!.col).toBeGreaterThanOrEqual(4)
    expect(p!.col).toBeLessThan(8)
  })
  it('does not join diagonal pixels and returns null for a missing colour', () => {
    const p = largestPatch(image(4, 4, [[0, 0, G], [1, 1, G]]), 4, 4, G)
    expect(p?.size).toBe(1)
    expect(largestPatch(image(4, 4, []), 4, 4, G)).toBeNull()
  })
})

describe('waypoint targets', () => {
  const w = (sol: number): WaypointInfo => ({ sol, site: 1, drive: 2, tiltDeg: 3.14, pitchDeg: 0, rollDeg: 0, yawDeg: 0, distTotalM: 0, x: 1, z: 2 })
  it('ids are stable and unique', () => {
    const t = waypointTargets([w(5), w(5), w(6)])
    expect(t.map((x) => x.id)).toEqual(['wp-5-1-2', 'wp-5-1-2-2', 'wp-6-1-2'])
    expect(waypointId(w(5), new Set())).toBe('wp-5-1-2')
  })
  it('shows sol and measured tilt', () => {
    const t = waypointTargets([w(718)])[0]!
    expect(t.label).toContain('718')
    expect(t.detail).toContain('3.1')
  })
})
