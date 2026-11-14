/**
 * Framework-free CPU terrain model. Single source of truth for heights on the main thread:
 * camera, rover and planners sample it, nothing raycasts per frame.
 *
 * Conventions (shared with the Python pipeline, see python/src/marsx/pipeline/geo.py):
 *  - pixel coords are continuous, (0,0) = upper-left CORNER of pixel (0,0); centre of pixel (c,r) = (c+.5, r+.5)
 *  - rows grow SOUTH; local CRS metres: x east, y north, origin at window centre
 *  - three.js world: x = east, y = up, z = SOUTH  (so z = -northing)
 */
export const MARS_RADIUS_M = 3396190
export const NODATA_U16 = 65535

export interface HeightfieldParams {
  width: number
  height: number
  /** metres per pixel */
  res: number
  /** GDAL affine (a,b,c,d,e,f); only north-up grids (b=d=0) are supported */
  transform: readonly [number, number, number, number, number, number]
  center: { lon: number; lat: number }
}

export interface U16Encoding {
  scale: number
  offset: number
  nodata: number
}

/**
 * Decodes little-endian Uint16 heights. Nodata pixels become NaN, then are filled (by iterative
 * neighbour averaging) so the CPU surface is always finite.
 */
export function decodeU16(
  raw: Uint16Array,
  enc: U16Encoding,
  width: number,
  height: number,
): { heights: Float32Array; nodataCount: number } {
  const out = new Float32Array(raw.length)
  let missing = 0
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i]!
    if (q === enc.nodata) {
      out[i] = Number.NaN
      missing++
    } else out[i] = q * enc.scale + enc.offset
  }
  if (missing > 0) fillNaN(out, width, height)
  return { heights: out, nodataCount: missing }
}

/** Fills NaN cells with the mean of valid 4-neighbours, sweeping until none are left. */
export function fillNaN(a: Float32Array, w: number, h: number): void {
  let remaining = 0
  for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i]!)) remaining++
  let guard = w + h
  while (remaining > 0 && guard-- > 0) {
    const fills: Array<[number, number]> = []
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const i = r * w + c
        if (!Number.isNaN(a[i]!)) continue
        let s = 0
        let n = 0
        if (c > 0 && !Number.isNaN(a[i - 1]!)) {
          s += a[i - 1]!
          n++
        }
        if (c < w - 1 && !Number.isNaN(a[i + 1]!)) {
          s += a[i + 1]!
          n++
        }
        if (r > 0 && !Number.isNaN(a[i - w]!)) {
          s += a[i - w]!
          n++
        }
        if (r < h - 1 && !Number.isNaN(a[i + w]!)) {
          s += a[i + w]!
          n++
        }
        if (n > 0) fills.push([i, s / n])
      }
    }
    if (fills.length === 0) break
    for (const [i, v] of fills) a[i] = v
    remaining -= fills.length
  }
  if (remaining > 0) {
    // an entirely nodata raster: flatten to zero instead of leaking NaN into the renderer
    for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i]!)) a[i] = 0
  }
}

export class Heightfield {
  readonly width: number
  readonly height: number
  readonly res: number
  /** world X of the upper-left corner */
  readonly x0: number
  /** local northing of the upper-left corner (world z of that corner = -y0) */
  readonly y0: number
  readonly heights: Float32Array
  readonly center: { lon: number; lat: number }
  readonly zMin: number
  readonly zMax: number

  constructor(p: HeightfieldParams, heights: Float32Array) {
    if (heights.length !== p.width * p.height) throw new Error('heights length does not match grid size')
    if (p.transform[1] !== 0 || p.transform[3] !== 0) throw new Error('rotated grids are not supported')
    this.width = p.width
    this.height = p.height
    this.res = p.res
    this.x0 = p.transform[2]
    this.y0 = p.transform[5]
    this.center = p.center
    this.heights = heights
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < heights.length; i++) {
      const v = heights[i]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    this.zMin = lo
    this.zMax = hi
  }

  /** World extents: x in [xMin,xMax] (east), z in [zMin,zMax] (south). */
  get extent() {
    return {
      xMin: this.x0,
      xMax: this.x0 + this.width * this.res,
      zMin: -this.y0,
      zMax: -this.y0 + this.height * this.res,
    }
  }

  /** world (x east, z south) -> continuous pixel (col,row) */
  worldToPixel(x: number, z: number): { col: number; row: number } {
    return { col: (x - this.x0) / this.res, row: (z + this.y0) / this.res }
  }

  /** continuous pixel -> world. Pass centre=true for integer pixel indices (pixel centre). */
  pixelToWorld(col: number, row: number, centre = false): { x: number; z: number } {
    const o = centre ? 0.5 : 0
    return { x: this.x0 + (col + o) * this.res, z: -this.y0 + (row + o) * this.res }
  }

  worldToLonLat(x: number, z: number): { lon: number; lat: number } {
    const lat0 = (this.center.lat * Math.PI) / 180
    const lat = this.center.lat + ((-z / MARS_RADIUS_M) * 180) / Math.PI
    const lon = this.center.lon + ((x / (MARS_RADIUS_M * Math.cos(lat0))) * 180) / Math.PI
    return { lon, lat }
  }

  lonLatToWorld(lon: number, lat: number): { x: number; z: number } {
    const lat0 = (this.center.lat * Math.PI) / 180
    const x = MARS_RADIUS_M * Math.cos(lat0) * (((lon - this.center.lon) * Math.PI) / 180)
    const north = MARS_RADIUS_M * (((lat - this.center.lat) * Math.PI) / 180)
    return { x, z: -north }
  }

  inBounds(x: number, z: number): boolean {
    const e = this.extent
    return x >= e.xMin && x <= e.xMax && z >= e.zMin && z <= e.zMax
  }

  /** Height at an integer pixel, edge-clamped. */
  private at(col: number, row: number): number {
    const c = col < 0 ? 0 : col >= this.width ? this.width - 1 : col
    const r = row < 0 ? 0 : row >= this.height ? this.height - 1 : row
    return this.heights[r * this.width + c]!
  }

  /**
   * Bilinear height at world (x,z). Samples live at pixel centres. Outside the raster the nearest
   * edge value is returned (clamped), never NaN.
   */
  sampleHeight(x: number, z: number): number {
    const { col, row } = this.worldToPixel(x, z)
    const fx = col - 0.5
    const fy = row - 0.5
    const c0 = Math.floor(fx)
    const r0 = Math.floor(fy)
    const tx = fx - c0
    const ty = fy - r0
    const h00 = this.at(c0, r0)
    const h10 = this.at(c0 + 1, r0)
    const h01 = this.at(c0, r0 + 1)
    const h11 = this.at(c0 + 1, r0 + 1)
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty
  }

  /** Unit surface normal (world axes: x east, y up, z south) from central differences. */
  normalAt(x: number, z: number, step = this.res): { x: number; y: number; z: number } {
    const dhdx = (this.sampleHeight(x + step, z) - this.sampleHeight(x - step, z)) / (2 * step)
    const dhdz = (this.sampleHeight(x, z + step) - this.sampleHeight(x, z - step)) / (2 * step)
    const inv = 1 / Math.hypot(dhdx, 1, dhdz)
    return { x: -dhdx * inv, y: inv, z: -dhdz * inv }
  }

  /** Slope in degrees (0 = flat). */
  slopeDegAt(x: number, z: number): number {
    const n = this.normalAt(x, z)
    return (Math.acos(Math.min(1, Math.max(-1, n.y))) * 180) / Math.PI
  }
}
