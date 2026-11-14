import { describe, expect, it } from 'vitest'
import { Heightfield } from '@/core/terrain/heightfield'
import { PathFollower, wrapAngle } from './path-follower'
import { roverPose } from './pose'

function field(fn: (c: number, r: number) => number, n = 64) {
  const heights = new Float32Array(n * n)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) heights[r * n + c] = fn(c, r)
  return new Heightfield(
    { width: n, height: n, res: 1, transform: [1, 0, -n / 2, 0, -1, n / 2], center: { lon: 77, lat: 18 } },
    heights,
  )
}

describe('PathFollower', () => {
  it('drives a straight path at the requested speed and finishes', () => {
    const f = new PathFollower(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
      ],
      { speed: 2 },
    )
    let t = 0
    while (!f.state.done && t < 20) {
      f.step(1 / 60)
      t += 1 / 60
    }
    expect(f.state.done).toBe(true)
    expect(f.state.x).toBeCloseTo(10)
    expect(t).toBeGreaterThan(4.9)
    expect(t).toBeLessThan(5.2)
  })

  it('turns smoothly at corners (no instant heading change) and visits every waypoint', () => {
    const f = new PathFollower(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
      ],
      { speed: 3 },
    )
    let maxDyaw = 0
    let prev = f.state.yaw
    let guard = 0
    while (!f.state.done && guard++ < 20000) {
      f.step(1 / 60)
      maxDyaw = Math.max(maxDyaw, Math.abs(wrapAngle(f.state.yaw - prev)))
      prev = f.state.yaw
    }
    expect(f.state.done).toBe(true)
    expect(f.state.x).toBeCloseTo(10)
    expect(f.state.z).toBeCloseTo(10)
    expect(maxDyaw).toBeLessThan(((60 * Math.PI) / 180) / 60 + 1e-6)
  })

  it('loops when asked and rejects invalid input', () => {
    const f = new PathFollower([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }], { speed: 4, loop: true })
    for (let i = 0; i < 2000; i++) f.step(1 / 60)
    expect(f.state.done).toBe(false)
    expect(() => new PathFollower([{ x: 0, z: 0 }], { speed: 1 })).toThrow()
    expect(() => new PathFollower([{ x: 0, z: 0 }, { x: 1, z: 1 }], { speed: 0 })).toThrow()
  })

  it('clamps huge dt (tab stall) instead of teleporting', () => {
    const f = new PathFollower([{ x: 0, z: 0 }, { x: 100, z: 0 }], { speed: 2 })
    f.step(60)
    expect(f.state.x).toBeLessThan(1)
  })
})

describe('roverPose', () => {
  it('is level on flat ground', () => {
    const p = roverPose(field(() => 3), 0, 0, 0)
    expect(p.pitchDeg).toBeCloseTo(0)
    expect(p.rollDeg).toBeCloseTo(0)
    expect(p.position.y).toBeCloseTo(3)
    expect(p.up.y).toBeCloseTo(1)
  })

  it('pitches up when climbing in the heading direction', () => {
    // rises towards +x at ~20 deg
    const slope = Math.tan((20 * Math.PI) / 180)
    const f = field((c) => c * slope)
    const east = roverPose(f, 0, 0, 0)
    const west = roverPose(f, 0, 0, Math.PI)
    expect(east.pitchDeg).toBeCloseTo(20, 0)
    expect(west.pitchDeg).toBeCloseTo(-20, 0)
    expect(Math.abs(east.rollDeg)).toBeLessThan(0.5)
  })

  it('rolls when traversing a slope', () => {
    const slope = Math.tan((15 * Math.PI) / 180)
    const f = field((c) => c * slope)
    const p = roverPose(f, 0, 0, Math.PI / 2) // heading south, ground rises to the east (rover's left)
    expect(Math.abs(p.rollDeg)).toBeCloseTo(15, 0)
    expect(Math.abs(p.pitchDeg)).toBeLessThan(0.5)
  })

  it('basis is orthonormal', () => {
    const f = field((c, r) => Math.sin(c / 5) * 2 + r * 0.2)
    const p = roverPose(f, 3, -4, 1.1)
    const d = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z
    expect(d(p.forward, p.up)).toBeCloseTo(0, 6)
    expect(d(p.right, p.up)).toBeCloseTo(0, 6)
    expect(d(p.right, p.forward)).toBeCloseTo(0, 6)
  })
})
