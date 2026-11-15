import { describe, expect, it } from 'vitest'
import { parseTraverse, parseWaypoints } from './traverse-data'

describe('traverse parsing', () => {
  it('flips northing into the world z axis', () => {
    const t = parseTraverse({
      features: [{ properties: { sol: 409, local: [[10, 20, -2500], [11, 22, -2500]] } }],
    })
    expect(t.totalPoints).toBe(2)
    expect(Array.from(t.lines[0]!.xz)).toEqual([10, -20, 11, -22])
  })
  it('rejects non-finite coordinates', () => {
    expect(() => parseTraverse({ features: [{ properties: { local: [[Number.NaN, 0, 0]] } }] })).toThrow()
  })
  it('maps waypoints with measured tilt and flips z', () => {
    const w = parseWaypoints({
      features: [{ properties: { sol: 409, site: 22, drive: 0, pitch: 0.3, roll: -0.7, yaw: -79, tilt: 0.8, distTotalM: 9748, local: [951, -459, -2545] } }],
    })
    expect(w[0]).toMatchObject({ sol: 409, tiltDeg: 0.8, x: 951, z: 459 })
  })
})
