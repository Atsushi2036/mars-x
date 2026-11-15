import { describe, expect, it } from 'vitest'
import { curveAt, curveFor, dampAngle, headingAhead, maxDeviation, smoothPath, type XZ } from './curve'

// a staircase on 2 m cells: right, down, right, down ... (the worst zigzag the 8-connected planner produces)
const zigzag: XZ[] = []
for (let i = 0; i < 12; i++) zigzag.push({ x: i * 2, z: Math.floor((i + 1) / 2) * 2 + (i % 2 ? 0 : 0) })
const stairs: XZ[] = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 4, z: 2 }, { x: 4, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 6 }, { x: 8, z: 6 }, { x: 8, z: 8 }]

describe('route curve', () => {
  it('keeps the smoothed route within 1 m of the planned cells and on its endpoints', () => {
    for (const p of [stairs, zigzag]) {
      const s = smoothPath(p)
      expect(maxDeviation(s, p)).toBeLessThanOrEqual(1)
      expect(s[0]).toEqual(p[0])
      expect(s[s.length - 1]).toEqual(p[p.length - 1])
    }
  })

  it('is parametrised by arc length: equal steps in s move equal distances', () => {
    const c = curveFor(stairs)
    const step = 0.5
    let prev = curveAt(c, 0)
    let px = prev.x
    let pz = prev.z
    for (let s = step; s <= c.length - step; s += step) {
      prev = curveAt(c, s)
      // chord of a smooth curve is a little shorter than the arc: within 10 %
      const d = Math.hypot(prev.x - px, prev.z - pz)
      expect(d).toBeGreaterThan(step * 0.9)
      expect(d).toBeLessThanOrEqual(step + 1e-9)
      px = prev.x
      pz = prev.z
    }
  })

  it('the line and the agent share one curve object per path', () => {
    expect(curveFor(stairs)).toBe(curveFor(stairs))
  })

  it('driving the curve at 60 fps with the damped look-ahead heading never turns more than 3 degrees per frame', () => {
    const c = curveFor(stairs)
    const speed = 3 // m/s at 1x
    const dt = 1 / 60
    let yaw = headingAhead(c, 0)
    let worst = 0
    for (let s = 0; s < c.length; s += speed * dt) {
      const next = dampAngle(yaw, headingAhead(c, s, 4), dt, 6)
      worst = Math.max(worst, Math.abs(next - yaw))
      yaw = next
    }
    expect((worst * 180) / Math.PI).toBeLessThan(3)
  })

  it('moves a little every frame: position changes at each 60 fps step', () => {
    const c = curveFor(stairs)
    let last = curveAt(c, 0)
    let lx = last.x
    let lz = last.z
    for (let i = 1; i < 120; i++) {
      last = curveAt(c, (i * 3) / 60)
      expect(Math.hypot(last.x - lx, last.z - lz)).toBeGreaterThan(0.01)
      lx = last.x
      lz = last.z
    }
  })
})
