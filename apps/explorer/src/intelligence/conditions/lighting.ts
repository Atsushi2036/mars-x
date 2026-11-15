import type { ConditionsHook } from '../sim/env-lite'
import { HorizonMaps } from './tables'

/**
 * L2 lighting and energy sources, ported from python marsx.conditions.insolation (Appelbaum and Flood 1990,
 * TM-103623) and marsx.env.l2.MarsConditions. Time-only quantities (sun position, irradiance) live in
 * 1-minute series; per-cell work is the 16-azimuth horizon test and the sky view factor.
 */

const SOLAR_CONSTANT = 1361
const Z_MAX_FIT_DEG = 85
const MINUTE_S = 60
export const MISSING = -1
const SOLAR_PANEL_W = 140
const SOLAR_REF_IRRADIANCE = 586.2
const SOLAR_DUST_LOSS = 0.2
const RTG_BOL_W = 110

// Table III of the paper: P[k][j][i] = p(i, j, k)
const P = [
  [
    [1.0028, -0.228681, 0.019613, 0.000231, -0.00013, 0.000003],
    [-0.450073, 1.335955, -1.131691, 0.402126, -0.063967, 0.003758],
    [5.566705, -16.912405, 13.739701, -4.756079, 0.74374, -0.043159],
    [-22.471579, 64.909973, -52.50947, 17.997548, -2.786548, 0.16034],
    [36.334497, -101.800319, 79.895539, -26.762885, 4.074117, -0.231476],
    [-20.42049, 53.207148, -39.949537, 12.977108, -1.931169, 0.107837],
  ],
  [
    [0.009814, 0.226139, -0.117733, 0.030579, -0.00409, 0.000218],
    [-0.156701, 0.396821, -0.313648, 0.099227, -0.013508, 0.000651],
    [1.361122, -3.758111, 3.007907, -0.987457, 0.141693, -0.00732],
    [-4.365924, 12.539251, -10.394165, 3.486452, -0.513123, 0.027401],
    [5.991693, -17.498138, 14.29137, -4.765323, 0.703675, -0.03796],
    [-2.915099, 8.275686, -6.593125, 2.173999, -0.320308, 0.017335],
  ],
] as const

/** Eq. (18): normalised net flux function f(z, tau, albedo). */
export function netFluxF(zenithDeg: number, tau: number, albedo = 0.1): number {
  if (!Number.isFinite(tau) || tau < 0 || tau > 6) throw new RangeError('optical depth must be in [0, 6]')
  if (!(albedo >= 0.1 && albedo <= 0.4)) throw new RangeError('albedo must be in [0.1, 0.4]')
  const z = Math.min(Math.max(zenithDeg, 0), Z_MAX_FIT_DEG) / 100
  let poly = 0
  for (let k = 0; k < 2; k++) {
    let sum = 0
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 6; i++) sum += z ** j * P[k]![j]![i]! * tau ** i
    }
    poly += albedo ** k * sum
  }
  return poly * (1 - albedo)
}

/** Global, direct and diffuse irradiance on a horizontal open surface, W/m2 (zero with the sun below the horizon). */
export function surfaceIrradiance(zenithDeg: number, tau: number, rAu: number, albedo = 0.1) {
  const f = netFluxF(zenithDeg, tau, albedo)
  const up = zenithDeg < 90
  const cosz = up ? Math.cos((Math.min(zenithDeg, 90) * Math.PI) / 180) : 0
  const gob = SOLAR_CONSTANT / rAu ** 2
  const beam = cosz > 0 ? gob * cosz * Math.exp(-tau / cosz) : 0
  const glob = up ? (gob * cosz * f) / (1 - albedo) : 0
  const direct = Math.min(beam, glob)
  return { global: glob, direct, diffuse: glob - direct }
}

export const solarPowerW = (irradiance: number) => (SOLAR_PANEL_W * Math.max(irradiance, 0)) / SOLAR_REF_IRRADIANCE * (1 - SOLAR_DUST_LOSS)

export interface SunMinutes {
  /** compass azimuth deg, clockwise from north */
  azDeg: ArrayLike<number>
  elevDeg: ArrayLike<number>
  rAu: ArrayLike<number>
}

/** Per-minute direct/diffuse series for a given dust opacity (single tau, like a scenario tau). */
export function irradianceSeries(sun: SunMinutes, tau: number) {
  const n = sun.elevDeg.length
  const direct = new Float64Array(n)
  const diffuse = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const r = surfaceIrradiance(90 - sun.elevDeg[i]!, tau, sun.rAu[i]!)
    direct[i] = r.direct
    diffuse[i] = r.diffuse
  }
  return { direct, diffuse }
}

export interface LightingOptions {
  azDeg: ArrayLike<number>
  elevDeg: ArrayLike<number>
  direct: ArrayLike<number>
  diffuse: ArrayLike<number>
  horizon?: HorizonMaps
  /** per-cell sky view factor (row-major); default derives it from the horizon bins */
  skyView?: ArrayLike<number>
  cols: number
  /** optional obs/1 environment inputs; without them those features are reported as MISSING (-1) */
  ltstH?: ArrayLike<number>
  tempC?: ArrayLike<number>
  windMS?: ArrayLike<number>
  tauSeries?: ArrayLike<number>
  /** optional obs/1 comm inputs per minute; without them the comm block is [1, 0, 0] */
  link?: ArrayLike<number>
  owltS?: ArrayLike<number>
  toUplinkSols?: ArrayLike<number>
}

const clip = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

/** TypeScript counterpart of marsx.env.l2.MarsConditions (dynamics exact; obs features as complete as the inputs given). */
export class LightingConditions implements ConditionsHook {
  readonly n: number
  constructor(private readonly o: LightingOptions) {
    this.n = o.elevDeg.length
    if (this.n === 0 || o.azDeg.length !== this.n || o.direct.length !== this.n || o.diffuse.length !== this.n) {
      throw new Error('lighting series must share one positive length')
    }
  }

  private idx(tS: number) {
    return clip(Math.trunc(tS / MINUTE_S), 0, this.n - 1)
  }

  lit(tS: number, row: number, col: number): boolean {
    const i = this.idx(tS)
    const elev = this.o.elevDeg[i]!
    if (!(elev > 0)) return false
    if (!this.o.horizon) return true
    return elev > this.o.horizon.elevationAt(row, col, this.o.azDeg[i]!, 0) // nodata bins = open sky, like the python loader
  }

  private svfAt(row: number, col: number): number {
    if (this.o.skyView) return this.o.skyView[row * this.o.cols + col]!
    return this.o.horizon ? this.o.horizon.skyViewFactor(row, col) : 1 // python: mean(cos^2) of the float16 horizon
  }

  irradiance(tS: number, row: number, col: number): number {
    const i = this.idx(tS)
    return (this.lit(tS, row, col) ? this.o.direct[i]! : 0) + this.o.diffuse[i]! * this.svfAt(row, col)
  }

  generationW(kind: 'rtg_rover' | 'solar_rover' | 'astronaut', tS: number, row: number, col: number): number {
    if (kind === 'solar_rover') return solarPowerW(this.irradiance(tS, row, col))
    if (kind === 'rtg_rover') return RTG_BOL_W
    return 0
  }

  features(tS: number): number[] {
    const i = this.idx(tS)
    const el = (this.o.elevDeg[i]! * Math.PI) / 180
    const az = (this.o.azDeg[i]! * Math.PI) / 180
    const ang = this.o.ltstH ? (2 * Math.PI * this.o.ltstH[i]!) / 24 : Number.NaN
    const orMissing = (v: number) => (Number.isNaN(v) ? MISSING : v)
    const temp = this.o.tempC ? clip((this.o.tempC[i]! + 100) / 80, 0, 1) : Number.NaN
    const tau = this.o.tauSeries ? clip(this.o.tauSeries[i]! / 3, 0, 1) : Number.NaN
    const wind = this.o.windMS ? clip(this.o.windMS[i]! / 30, 0, 1) : Number.NaN
    return [Math.sin(el), Math.sin(az), Math.cos(az), Number.isNaN(ang) ? 0 : Math.sin(ang), Number.isNaN(ang) ? 0 : Math.cos(ang), orMissing(temp), orMissing(tau), orMissing(wind)]
  }

  comm(tS: number): number[] {
    if (!this.o.link || !this.o.owltS || !this.o.toUplinkSols) return [1, 0, 0]
    const i = this.idx(tS)
    return [this.o.link[i]! > 0.5 ? 1 : 0, clip(this.o.toUplinkSols[i]!, 0, 1), clip(this.o.owltS[i]! / (22 * 60), 0, 1)]
  }
}
