import { describe, expect, it } from 'vitest'
import { curveAt, curveFor, headingAhead, dampAngle, type XZ } from './curve'
import { PathFollower } from './path-follower'

/**
 * Regression for "the rover freezes at the first turn": the old Watch drove a steer-to-waypoint follower whose turn rate (60 deg/s)
 * is far too slow for the pace the playback asked for (a 304 m route in 30 s = 10 m/s, turning radius ~10 m). On 2 m cells it
 * circled a waypoint it could never reach. The route Watch now reads the position off the arc-length curve: no steering to block.
 */
const route: XZ[] = []
// a long diagonal staircase like the planner draws (8-connected, 2 m cells) ending with an L
for (let i = 0; i < 40; i++) route.push({ x: 65 + i * 2, z: 9 + i * 2 })
for (let i = 1; i <= 20; i++) route.push({ x: 143 + i * 2, z: 87 })
for (let i = 1; i <= 30; i++) route.push({ x: 183, z: 87 + i * 2 })

const pathLen = (p: XZ[]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q.x - p[i - 1]!.x, q.z - p[i - 1]!.z) : 0), 0)

describe('route playback does not stall', () => {
  it('the steer-to-waypoint follower at the old 10 m/s pace never finishes (the bug)', () => {
    const f = new PathFollower(route, { speed: 10 })
    for (let i = 0; i < 60 * 120 && !f.state.done; i++) f.step(1 / 60)
    // 2 minutes of simulated time for a route that should take about 30 s: it is stuck circling a corner
    expect(f.state.done).toBe(false)
  })

  it('the arc-length curve reaches the destination in length / speed, advancing on every frame', () => {
    const c = curveFor(route)
    const speed = 3
    const dt = 1 / 60
    let s = 0
    let yaw = headingAhead(c, 0)
    let frames = 0
    let stalled = 0
    let last = curveAt(c, 0)
    let lx = last.x
    let lz = last.z
    while (s < c.length && frames < 60 * 600) {
      s = Math.min(c.length, s + speed * dt)
      last = curveAt(c, s)
      yaw = dampAngle(yaw, headingAhead(c, s, 4), dt, 6)
      if (s < c.length && Math.hypot(last.x - lx, last.z - lz) < 1e-4) stalled++
      lx = last.x
      lz = last.z
      frames++
    }
    const expected = c.length / speed
    expect(frames / 60).toBeCloseTo(expected, 0)
    expect(stalled).toBe(0)
    expect(Math.hypot(last.x - route.at(-1)!.x, last.z - route.at(-1)!.z)).toBeLessThan(0.01)
    expect(c.length).toBeLessThanOrEqual(pathLen(route) + 1e-6) // smoothing only shortens the route a little
  })
})
