import { z } from 'zod'

/**
 * Read-only access to the condition tables the Python pipeline publishes (python/src/marsx/pipeline/
 * tables.py, derive.horizon_maps). The web never computes astronomy: it only decodes bytes and does
 * interpolation/comparison. Binary layouts (little endian, row-major):
 *  - horizon.u8      u8  [16, rows, cols]  elevation deg = q * 0.5, 255 = nodata, azimuth k = k * 22.5 deg cw from north
 *  - sky_view        u8  [rows, cols]      factor = q / 254, 255 = nodata
 *  - slip_class      u8  [rows, cols]      0 loose, 1 mixed, 2 rocky, 255 unknown
 *  - sun_table       f32 [n, 3]            azimuth deg cw from north, elevation deg, Mars-Sun AU; fixed step
 *  - owlt_table      f32 [n, 2]            one-way light time s, link available 0/1; fixed step
 */

export const U8_NODATA = 255
export const ANGLE_SCALE = 0.5
export const SVF_ONE = 254
export const N_AZ = 16

export const SLIP_CLASSES = { 0: 'loose fines / sand', 1: 'mixed / indurated', 2: 'rock / bedrock', 255: 'unknown' } as const
export type SlipClassCode = keyof typeof SLIP_CLASSES

const dims = z.object({ rows: z.number().int().positive().max(8192), cols: z.number().int().positive().max(8192) }).strict()
const sizeCheck = (name: string, got: number, want: number) => {
  if (got !== want) throw new Error(`${name}: expected ${want} bytes, got ${got}`)
}

// -------------------------------------------------------------------------- horizon + sunlight

export class HorizonMaps {
  constructor(
    readonly q: Uint8Array,
    readonly rows: number,
    readonly cols: number,
  ) {
    dims.parse({ rows, cols })
    sizeCheck('horizon', q.length, N_AZ * rows * cols)
  }

  /**
   * Horizon elevation (deg) at (row, col) for a compass azimuth, interpolated between the 16 bins; NaN if nodata
   * unless `nodataAs` gives the value to use for nodata bins (python env loads nodata horizon as 0 = open sky).
   */
  elevationAt(row: number, col: number, azimuthDeg: number, nodataAs?: number): number {
    const pos = (((azimuthDeg % 360) + 360) % 360) / (360 / N_AZ)
    const i0 = Math.floor(pos) % N_AZ
    const i1 = (i0 + 1) % N_AZ
    const w = pos - Math.floor(pos)
    const plane = this.rows * this.cols
    const idx = row * this.cols + col
    const qa = this.q[i0 * plane + idx]!
    const qb = this.q[i1 * plane + idx]!
    if (nodataAs === undefined && (qa === U8_NODATA || qb === U8_NODATA)) return Number.NaN
    const a = qa === U8_NODATA ? nodataAs! : qa * ANGLE_SCALE
    const b = qb === U8_NODATA ? nodataAs! : qb * ANGLE_SCALE
    return a * (1 - w) + b * w
  }

  /** Sun above the local horizon (same rule as the Python shaded irradiance); nodata counts as lit. */
  isLit(row: number, col: number, sunAzimuthDeg: number, sunElevationDeg: number): boolean {
    if (sunElevationDeg <= 0) return false
    const h = this.elevationAt(row, col, sunAzimuthDeg)
    return Number.isNaN(h) ? true : sunElevationDeg > h
  }

  /** Sky view factor from the 16 bins: mean(cos^2 horizon). NaN if any bin is nodata. */
  skyViewFactor(row: number, col: number): number {
    const plane = this.rows * this.cols
    let s = 0
    for (let k = 0; k < N_AZ; k++) {
      const q = this.q[k * plane + row * this.cols + col]!
      if (q === U8_NODATA) return Number.NaN
      s += Math.cos((q * ANGLE_SCALE * Math.PI) / 180) ** 2
    }
    return s / N_AZ
  }
}

// -------------------------------------------------------------------------- per-cell u8 layers

export function decodeSkyView(q: Uint8Array, rows: number, cols: number): Float32Array {
  dims.parse({ rows, cols })
  sizeCheck('sky view', q.length, rows * cols)
  return Float32Array.from(q, (v) => (v === U8_NODATA ? Number.NaN : v / SVF_ONE))
}

export function slipClassLabel(code: number): string {
  return SLIP_CLASSES[code as SlipClassCode] ?? SLIP_CLASSES[255]
}

export function validateSlipClasses(q: Uint8Array, rows: number, cols: number): Uint8Array {
  dims.parse({ rows, cols })
  sizeCheck('slip class', q.length, rows * cols)
  for (const v of q) if (v !== 0 && v !== 1 && v !== 2 && v !== 255) throw new Error(`slip class: invalid code ${v}`)
  return q
}

// -------------------------------------------------------------------------- time tables

export const tableMetaSchema = z
  .object({
    /** UTC milliseconds of row 0 */
    startMs: z.number().finite(),
    /** seconds between rows */
    stepS: z.number().finite().positive(),
  })
  .strict()
export type TableMeta = z.infer<typeof tableMetaSchema>

export interface SunState {
  azimuthDeg: number
  elevationDeg: number
  rAu: number
}

export class SunTable {
  private readonly meta: TableMeta
  readonly n: number
  constructor(
    private readonly data: Float32Array,
    meta: TableMeta,
  ) {
    this.meta = tableMetaSchema.parse(meta)
    if (data.length === 0 || data.length % 3 !== 0) throw new Error('sun table: length must be a positive multiple of 3')
    this.n = data.length / 3
  }

  /** Linear interpolation; azimuth interpolated on the circle. Throws outside the tabulated range. */
  at(unixMs: number): SunState {
    const f = (unixMs - this.meta.startMs) / 1000 / this.meta.stepS
    if (!Number.isFinite(f) || f < 0 || f > this.n - 1) throw new RangeError('time outside the sun table')
    const i0 = Math.floor(f)
    const i1 = Math.min(i0 + 1, this.n - 1)
    const w = f - i0
    const d = this.data
    let dAz = d[3 * i1]! - d[3 * i0]!
    if (dAz > 180) dAz -= 360
    else if (dAz < -180) dAz += 360
    return {
      azimuthDeg: (((d[3 * i0]! + dAz * w) % 360) + 360) % 360,
      elevationDeg: d[3 * i0 + 1]! * (1 - w) + d[3 * i1 + 1]! * w,
      rAu: d[3 * i0 + 2]! * (1 - w) + d[3 * i1 + 2]! * w,
    }
  }
}

export interface LinkState {
  owltS: number
  linkAvailable: boolean
}

export class OwltTable {
  private readonly meta: TableMeta
  readonly n: number
  constructor(
    private readonly data: Float32Array,
    meta: TableMeta,
  ) {
    this.meta = tableMetaSchema.parse(meta)
    if (data.length === 0 || data.length % 2 !== 0) throw new Error('owlt table: length must be a positive multiple of 2')
    this.n = data.length / 2
  }

  at(unixMs: number): LinkState {
    const f = (unixMs - this.meta.startMs) / 1000 / this.meta.stepS
    if (!Number.isFinite(f) || f < 0 || f > this.n - 1) throw new RangeError('time outside the OWLT table')
    const i0 = Math.floor(f)
    const i1 = Math.min(i0 + 1, this.n - 1)
    const w = f - i0
    const d = this.data
    return {
      owltS: d[2 * i0]! * (1 - w) + d[2 * i1]! * w,
      // conservative: the link is available only if both bracketing rows say so
      linkAvailable: d[2 * i0 + 1]! > 0.5 && d[2 * i1 + 1]! > 0.5,
    }
  }

  /** Hours until the next row with the link available (0 if available now); null if none in range. */
  hoursToLink(unixMs: number): number | null {
    const f = Math.max(0, (unixMs - this.meta.startMs) / 1000 / this.meta.stepS)
    for (let i = Math.ceil(f); i < this.n; i++) {
      if (this.data[2 * i + 1]! > 0.5) {
        return Math.max(0, (this.meta.startMs + i * this.meta.stepS * 1000 - unixMs) / 3_600_000)
      }
    }
    return null
  }
}

/** Reinterprets little-endian bytes as float32 (copying when the view is unaligned). */
export function f32FromBytes(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) throw new Error('float32 table: byte length not a multiple of 4')
  const copy = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice()
  const dv = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  const out = new Float32Array(copy.byteLength / 4)
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(4 * i, true)
  return out
}
