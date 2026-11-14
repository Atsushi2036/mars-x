import { describe, expect, it } from 'vitest'
import { HorizonMaps, OwltTable, SunTable, decodeSkyView, f32FromBytes, slipClassLabel, validateSlipClasses } from '../conditions/tables'

describe('HorizonMaps', () => {
  // 1x2 grid: cell 0 has a flat horizon, cell 1 a 10 deg ridge toward the east (az index 4 = 90 deg)
  const q = new Uint8Array(16 * 2)
  q[4 * 2 + 1] = 20 // 10 deg
  const h = new HorizonMaps(q, 1, 2)
  it('interpolates between the 16 azimuth bins like python horizon_elevation_at', () => {
    expect(h.elevationAt(0, 1, 90)).toBeCloseTo(10)
    expect(h.elevationAt(0, 1, 90 + 11.25)).toBeCloseTo(5) // halfway to the next bin (0 deg)
    expect(h.elevationAt(0, 1, 450)).toBeCloseTo(10) // wraps
    expect(h.elevationAt(0, 1, -270)).toBeCloseTo(10)
  })
  it('lit/shadow follows sun elevation vs horizon', () => {
    expect(h.isLit(0, 1, 90, 12)).toBe(true)
    expect(h.isLit(0, 1, 90, 8)).toBe(false)
    expect(h.isLit(0, 0, 90, 1)).toBe(true)
    expect(h.isLit(0, 0, 90, -1)).toBe(false)
  })
  it('sky view factor = mean cos^2', () => {
    expect(h.skyViewFactor(0, 0)).toBe(1)
    const expected = (15 + Math.cos((10 * Math.PI) / 180) ** 2) / 16
    expect(h.skyViewFactor(0, 1)).toBeCloseTo(expected, 12)
  })
  it('nodata gives NaN elevation and counts as lit', () => {
    const qq = new Uint8Array(16).fill(255)
    const hh = new HorizonMaps(qq, 1, 1)
    expect(hh.elevationAt(0, 0, 10)).toBeNaN()
    expect(hh.isLit(0, 0, 10, 5)).toBe(true)
  })
  it('rejects a wrong-sized buffer', () => {
    expect(() => new HorizonMaps(new Uint8Array(10), 1, 2)).toThrow(/expected 32 bytes/)
  })
})

describe('u8 layers', () => {
  it('decodes sky view with nodata', () => {
    const v = decodeSkyView(Uint8Array.from([0, 127, 254, 255]), 2, 2)
    expect(v[0]).toBe(0)
    expect(v[1]).toBeCloseTo(0.5, 2)
    expect(v[2]).toBe(1)
    expect(v[3]).toBeNaN()
  })
  it('validates slip class codes', () => {
    expect(() => validateSlipClasses(Uint8Array.from([0, 1, 2, 255]), 2, 2)).not.toThrow()
    expect(() => validateSlipClasses(Uint8Array.from([0, 1, 2, 7]), 2, 2)).toThrow(/invalid code 7/)
    expect(slipClassLabel(2)).toMatch(/rock/)
    expect(slipClassLabel(99)).toBe('unknown')
  })
})

describe('time tables', () => {
  it('SunTable interpolates, handles azimuth wrap and refuses out-of-range', () => {
    const t = new SunTable(new Float32Array([350, 10, 1.5, 10, 20, 1.5]), { startMs: 0, stepS: 60 })
    const mid = t.at(30_000)
    expect(mid.azimuthDeg).toBeCloseTo(0, 4)
    expect(mid.elevationDeg).toBeCloseTo(15, 5)
    expect(t.at(0).azimuthDeg).toBeCloseTo(350, 4)
    expect(() => t.at(61_000)).toThrow(RangeError)
    expect(() => t.at(-1)).toThrow(RangeError)
  })
  it('OwltTable interpolates OWLT, is conservative on link, and finds the next window', () => {
    const t = new OwltTable(new Float32Array([600, 0, 700, 0, 800, 1]), { startMs: 0, stepS: 3600 })
    expect(t.at(1_800_000).owltS).toBeCloseTo(650)
    expect(t.at(1_800_000).linkAvailable).toBe(false)
    expect(t.at(2 * 3_600_000).linkAvailable).toBe(true)
    expect(t.hoursToLink(0)).toBeCloseTo(2)
    expect(t.hoursToLink(2 * 3_600_000)).toBe(0)
    const none = new OwltTable(new Float32Array([600, 0]), { startMs: 0, stepS: 3600 })
    expect(none.hoursToLink(0)).toBeNull()
  })
  it('rejects malformed tables and metadata', () => {
    expect(() => new SunTable(new Float32Array(4), { startMs: 0, stepS: 60 })).toThrow()
    expect(() => new OwltTable(new Float32Array(3), { startMs: 0, stepS: 60 })).toThrow()
    expect(() => new SunTable(new Float32Array(3), { startMs: 0, stepS: 0 })).toThrow()
    expect(() => new SunTable(new Float32Array(3), { startMs: Number.NaN, stepS: 1 })).toThrow()
  })
  it('f32FromBytes reads little endian even from an unaligned view', () => {
    const src = new Uint8Array(9)
    new DataView(src.buffer).setFloat32(1, 1.5, true)
    expect(f32FromBytes(src.subarray(1, 5))[0]).toBe(1.5)
    expect(() => f32FromBytes(new Uint8Array(3))).toThrow()
  })
})
