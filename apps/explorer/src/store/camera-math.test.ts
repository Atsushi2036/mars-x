import { describe, expect, it } from 'vitest'
import { azimuthOf, clampDistance, clampPitch, clampToTile, easeInOut, lerpAngle, orbitPosition, panStep } from './camera-math'

const EXT = { xMin: -1000, xMax: 1000, zMin: -1000, zMax: 1000 }

describe('camera math', () => {
  it('easeInOut is 0 at 0, 1 at 1 and monotonic', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const v = easeInOut(i / 20)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
  it('azimuth 0 puts the camera south of the target (north up)', () => {
    const p = orbitPosition({ x: 10, y: 5, z: 20 }, 0, Math.PI / 4, 100)
    expect(p.x).toBeCloseTo(10)
    expect(p.z).toBeGreaterThan(20)
    expect(azimuthOf(p.x - 10, p.z - 20)).toBeCloseTo(0)
  })
  it('azimuthOf inverts orbitPosition for any heading', () => {
    for (const az of [-2.5, -1, 0.7, 2.9]) {
      const p = orbitPosition({ x: 0, y: 0, z: 0 }, az, 0.8, 50)
      expect(azimuthOf(p.x, p.z)).toBeCloseTo(az)
    }
  })
  it('lerpAngle takes the short way round', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1)
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5)
  })
  it('keeps the target inside the tile after 50 random drags', () => {
    let s = 7
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1
    let x = 0
    let z = 0
    for (let i = 0; i < 50; i++) {
      x += rnd() * 5000
      z += rnd() * 5000
      const c = clampToTile(x, z, EXT, 2)
      x = c.x
      z = c.z
      expect(x).toBeGreaterThanOrEqual(-998)
      expect(x).toBeLessThanOrEqual(998)
      expect(z).toBeGreaterThanOrEqual(-998)
      expect(z).toBeLessThanOrEqual(998)
    }
  })
  it('clamps distance to 20 m .. 2.4 km and pitch to 10..85 degrees', () => {
    expect(clampDistance(5)).toBe(20)
    expect(clampDistance(99999)).toBe(2400)
    expect(clampDistance(300)).toBe(300)
    expect(clampPitch(0)).toBeCloseTo((10 * Math.PI) / 180)
    expect(clampPitch(Math.PI / 2)).toBeCloseTo((85 * Math.PI) / 180)
  })
  it('pans relative to the azimuth: forward goes away from the camera', () => {
    const f0 = panStep(0, 1, 0, 10)
    expect(f0.x).toBeCloseTo(0)
    expect(f0.z).toBeCloseTo(-10) // looking north: forward = -z
    const f90 = panStep(-Math.PI / 2, 1, 0, 10) // looking east
    expect(f90.x).toBeCloseTo(10)
    const r0 = panStep(0, 0, 1, 10)
    expect(r0.x).toBeCloseTo(10)
  })
})
