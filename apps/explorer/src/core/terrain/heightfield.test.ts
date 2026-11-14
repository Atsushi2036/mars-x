import { describe, expect, it } from 'vitest'
import { decodeU16, Heightfield, NODATA_U16 } from './heightfield'

/** 4x4 grid, 2 m pixels, upper-left corner at world (-4, +4 northing) i.e. centred on origin. */
function makeField(fn: (c: number, r: number) => number, w = 4, h = 4, res = 2) {
  const heights = new Float32Array(w * h)
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) heights[r * w + c] = fn(c, r)
  return new Heightfield(
    {
      width: w,
      height: h,
      res,
      transform: [res, 0, (-w * res) / 2, 0, -res, (h * res) / 2],
      center: { lon: 77.4, lat: 18.45 },
    },
    heights,
  )
}

describe('bilinear sampleHeight', () => {
  const f = makeField((c, r) => c * 10 + r) // linear surface: bilinear must be exact

  it('returns the exact value at pixel centres (corners of the sample lattice)', () => {
    const p = f.pixelToWorld(0, 0, true)
    expect(f.sampleHeight(p.x, p.z)).toBeCloseTo(0)
    const q = f.pixelToWorld(3, 3, true)
    expect(f.sampleHeight(q.x, q.z)).toBeCloseTo(33)
    const s = f.pixelToWorld(3, 0, true)
    expect(f.sampleHeight(s.x, s.z)).toBeCloseTo(30)
  })

  it('interpolates at the centre of four pixels', () => {
    const a = f.pixelToWorld(1.5, 1.5, true)
    // pixel centres (1,1)=11 (2,1)=21 (1,2)=12 (2,2)=22 -> mean 16.5
    expect(f.sampleHeight(a.x, a.z)).toBeCloseTo(16.5)
  })

  it('clamps at and beyond the raster edges (no NaN)', () => {
    const e = f.extent
    expect(f.sampleHeight(e.xMin, e.zMin)).toBeCloseTo(0)
    expect(f.sampleHeight(e.xMin - 1000, e.zMin - 1000)).toBeCloseTo(0)
    expect(f.sampleHeight(e.xMax + 1000, e.zMax + 1000)).toBeCloseTo(33)
    expect(Number.isNaN(f.sampleHeight(1e9, -1e9))).toBe(false)
  })

  it('is monotone along a ramp and exact on a plane', () => {
    const p0 = f.pixelToWorld(1, 1, true)
    const p1 = f.pixelToWorld(2, 1, true)
    expect(f.sampleHeight((p0.x + p1.x) / 2, p0.z)).toBeCloseTo(16)
  })
})

describe('normals and slope', () => {
  it('flat terrain has an up normal and 0 deg slope', () => {
    const f = makeField(() => 5)
    const n = f.normalAt(0, 0)
    expect(n.x).toBeCloseTo(0)
    expect(n.z).toBeCloseTo(0)
    expect(n.y).toBeCloseTo(1)
    expect(f.slopeDegAt(0, 0)).toBeCloseTo(0)
  })

  it('45 deg ramp rising to the east', () => {
    // height grows 2 m per pixel (= res) towards +x => 45 deg, normal leans west (-x)
    const f = makeField((c) => c * 2, 8, 8, 2)
    expect(f.slopeDegAt(0, 0)).toBeCloseTo(45, 3)
    const n = f.normalAt(0, 0)
    expect(n.x).toBeLessThan(0)
    expect(n.z).toBeCloseTo(0)
  })

  it('rising to the north (rows grow south) leans the normal towards +z (south)', () => {
    const f = makeField((_c, r) => (7 - r) * 2, 8, 8, 2)
    const n = f.normalAt(0, 0)
    expect(n.z).toBeGreaterThan(0)
    expect(f.slopeDegAt(0, 0)).toBeCloseTo(45, 3)
  })
})

describe('coordinate round trips', () => {
  const f = makeField(() => 0, 8, 8, 1)

  it('world <-> pixel', () => {
    for (const [c, r] of [
      [0, 0],
      [3.25, 6.75],
      [8, 8],
    ] as const) {
      const w = f.pixelToWorld(c, r)
      const p = f.worldToPixel(w.x, w.z)
      expect(p.col).toBeCloseTo(c, 9)
      expect(p.row).toBeCloseTo(r, 9)
    }
  })

  it('upper-left corner is north-west, rows grow south', () => {
    const ul = f.pixelToWorld(0, 0)
    const lr = f.pixelToWorld(8, 8)
    expect(ul.x).toBeLessThan(lr.x) // east grows with col
    expect(ul.z).toBeLessThan(lr.z) // z (south) grows with row
    expect(f.worldToLonLat(ul.x, ul.z).lat).toBeGreaterThan(f.worldToLonLat(lr.x, lr.z).lat)
  })

  it('world <-> lon/lat, centre maps to the manifest centre', () => {
    const c = f.worldToLonLat(0, 0)
    expect(c.lon).toBeCloseTo(77.4, 9)
    expect(c.lat).toBeCloseTo(18.45, 9)
    const w = f.lonLatToWorld(77.41, 18.46)
    const back = f.worldToLonLat(w.x, w.z)
    expect(back.lon).toBeCloseTo(77.41, 9)
    expect(back.lat).toBeCloseTo(18.46, 9)
  })

  it('uses the local scale: 1 degree of longitude is cos(lat) of one of latitude', () => {
    const dx = f.lonLatToWorld(78.4, 18.45).x
    const dz = -f.lonLatToWorld(77.4, 19.45).z
    expect(dx / dz).toBeCloseTo(Math.cos((18.45 * Math.PI) / 180), 9)
  })
})

describe('decodeU16', () => {
  it('applies scale/offset and fills nodata from neighbours', () => {
    const raw = new Uint16Array([100, 200, NODATA_U16, 400])
    const { heights, nodataCount } = decodeU16(raw, { scale: 0.5, offset: -10, nodata: NODATA_U16 }, 2, 2)
    expect(nodataCount).toBe(1)
    expect(heights[0]).toBeCloseTo(40)
    expect(heights[1]).toBeCloseTo(90)
    expect(heights[3]).toBeCloseTo(190)
    expect(heights[2]).toBeCloseTo((40 + 190) / 2)
    expect(heights.every(Number.isFinite)).toBe(true)
  })

  it('an all-nodata raster becomes flat zero, never NaN', () => {
    const raw = new Uint16Array(9).fill(NODATA_U16)
    const { heights } = decodeU16(raw, { scale: 1, offset: 5, nodata: NODATA_U16 }, 3, 3)
    expect([...heights]).toEqual(new Array(9).fill(0))
  })

  it('is little-endian regardless of host (bytes 0x34 0x12 -> 0x1234)', () => {
    const bytes = new Uint8Array([0x34, 0x12])
    const raw = new Uint16Array(bytes.length / 2)
    new DataView(bytes.buffer).getUint16(0, true)
    raw[0] = new DataView(bytes.buffer).getUint16(0, true)
    const { heights } = decodeU16(raw, { scale: 1, offset: 0, nodata: NODATA_U16 }, 1, 1)
    expect(heights[0]).toBe(0x1234)
  })
})
