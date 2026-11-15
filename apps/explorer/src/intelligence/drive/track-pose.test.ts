import { describe, expect, it } from 'vitest'
import { extendCum, poseAt } from './track-pose'

describe('track pose by distance', () => {
  const xs = Float32Array.of(0, 2, 2, 4)
  const zs = Float32Array.of(0, 0, 2, 2)
  const cum = new Float32Array(4)
  extendCum(xs, zs, cum, 0, 4)

  it('accumulates metres', () => {
    expect(Array.from(cum)).toEqual([0, 2, 4, 6])
  })

  it('moving at v m/s for t seconds covers v*t metres along the track, frame by frame', () => {
    const v = 3
    let s = 0
    let prev = poseAt(xs, zs, cum, 3, 0)
    let px = prev.x
    let pz = prev.z
    let dist = 0
    for (let f = 0; f < 60 && s < cum[3]!; f++) {
      s = Math.min(cum[3]!, s + v / 60)
      prev = poseAt(xs, zs, cum, 3, s)
      dist += Math.hypot(prev.x - px, prev.z - pz)
      px = prev.x
      pz = prev.z
    }
    // 1 s at 3 m/s covers 3 m, whatever the step spacing of the track
    expect(dist).toBeCloseTo(3, 1)
  })

  it('clamps beyond the ends and handles a one-point track', () => {
    expect(poseAt(xs, zs, cum, 3, 99)).toMatchObject({ x: 4, z: 2 })
    expect(poseAt(xs, zs, cum, 3, -5)).toMatchObject({ x: 0, z: 0 })
    expect(poseAt(xs, zs, cum, 0, 3)).toMatchObject({ x: 0, z: 0, i: 0 })
  })
})
