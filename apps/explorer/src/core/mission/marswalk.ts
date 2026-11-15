import { astronautStepEnergyWh, ENERGY, evaConsumablesWh } from '@/intelligence/sim/energy'
import type { XZ } from './geometry'

/**
 * Marswalk budget for an astronaut route: EVA time, consumables (metabolic energy) and the space-weather
 * shelter rule. Pure functions over a world-space path and a height function.
 *
 * Provenance of the inputs (shown next to every number in the UI):
 *  - metabolic rate 197-302 kcal/h (780-1200 BTU/h): measured, Apollo EVA data (marsx.conditions.energy);
 *  - walking speed 1 m/s, EVA duration 4 h, stop time, shelter window 30 min: team assumptions, editable;
 *  - the shelter is the route start; the return uses the same path (no shorter way is assumed).
 */
export interface WalkParams {
  /** EVA duration, hours (assumption) */
  evaHours: number
  /** walking speed, m/s (assumption) */
  speedMs: number
  /** minutes the astronaut stays at the science target (assumption) */
  stopMin: number
  /** minutes allowed to reach the shelter after an SEP alert (assumption) */
  shelterMin: number
}

export const DEFAULT_WALK: WalkParams = {
  evaHours: ENERGY.evaDurationH,
  speedMs: ENERGY.astronautSpeed,
  stopMin: 30,
  shelterMin: 30,
}

export interface ShelterReport {
  windowS: number
  /** farthest distance along the route from which the shelter is reachable inside the window */
  maxSafeM: number
  /** distance along the route where the unsafe part begins; null when the whole route is safe */
  unsafeFromM: number | null
  unsafeM: number
  /** the unsafe sub-path (world points, starts at the boundary) */
  unsafePath: XZ[]
  /** the point at which the window runs out, for a map marker */
  boundary: XZ | null
}

export interface WalkReport {
  distanceM: number
  outboundS: number
  stopS: number
  returnS: number
  roundTripS: number
  evaBudgetS: number
  /** EVA time left after the whole round trip including the stop (negative = over budget) */
  marginS: number
  marginPct: number
  energyOutWh: number
  energyBackWh: number
  energyTotalWh: number
  /** the stop, at the low (resting) metabolic rate */
  stopEnergyWh: number
  consumablesWh: number
  energyMarginPct: number
  avgKcalPerH: number
  /** the longest one-way route the EVA budget allows, metres */
  maxOneWayM: number
  withinBudget: boolean
  shelter: ShelterReport
}

const KCAL_PER_WH = 0.8598

/** Length and signed slope (deg, uphill positive) of each segment of a path. */
export function walkSegments(path: XZ[], heightAt: (x: number, z: number) => number) {
  const segs: Array<{ len: number; slopeDeg: number; from: number }> = []
  let cum = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const dh = heightAt(b.x, b.z) - heightAt(a.x, a.z)
    segs.push({ len, slopeDeg: len > 0 ? (Math.atan2(dh, len) * 180) / Math.PI : 0, from: cum })
    cum += len
  }
  return { segs, total: cum }
}

/** The point at distance `d` along the polyline (linear interpolation). */
function pointAt(path: XZ[], segs: Array<{ len: number; from: number }>, d: number): XZ {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    if (d <= s.from + s.len || i === segs.length - 1) {
      const t = s.len > 0 ? Math.min(1, Math.max(0, (d - s.from) / s.len)) : 0
      const a = path[i]!
      const b = path[i + 1]!
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
    }
  }
  return path[0] ?? { x: 0, z: 0 }
}

export function marswalkReport(path: XZ[], heightAt: (x: number, z: number) => number, params: WalkParams = DEFAULT_WALK): WalkReport {
  const { segs, total } = walkSegments(path, heightAt)
  const v = params.speedMs
  let eOut = 0
  let eBack = 0
  for (const s of segs) {
    eOut += astronautStepEnergyWh(s.len, s.slopeDeg) // uphill costs more; downhill falls back to the resting rate
    eBack += astronautStepEnergyWh(s.len, -s.slopeDeg) // the way back sees every slope reversed
  }
  const outboundS = total / v
  const stopS = params.stopMin * 60
  const evaBudgetS = params.evaHours * 3600
  const roundTripS = 2 * outboundS + stopS
  const stopEnergyWh = (ENERGY.metRateLowW * stopS) / 3600
  const energyTotalWh = eOut + eBack + stopEnergyWh
  const consumablesWh = evaConsumablesWh() * (params.evaHours / ENERGY.evaDurationH)

  const windowS = params.shelterMin * 60
  const maxSafeM = windowS * v
  const unsafeFromM = total > maxSafeM ? maxSafeM : null
  const unsafePath: XZ[] = []
  let boundary: XZ | null = null
  if (unsafeFromM !== null && path.length > 1) {
    boundary = pointAt(path, segs, unsafeFromM)
    unsafePath.push(boundary)
    for (let i = 0; i < segs.length; i++) if (segs[i]!.from + segs[i]!.len > unsafeFromM) unsafePath.push(path[i + 1]!)
  }

  return {
    distanceM: total,
    outboundS,
    stopS,
    returnS: outboundS,
    roundTripS,
    evaBudgetS,
    marginS: evaBudgetS - roundTripS,
    marginPct: ((evaBudgetS - roundTripS) / evaBudgetS) * 100,
    energyOutWh: eOut,
    energyBackWh: eBack,
    energyTotalWh,
    stopEnergyWh,
    consumablesWh,
    energyMarginPct: ((consumablesWh - energyTotalWh) / consumablesWh) * 100,
    avgKcalPerH: roundTripS > 0 ? ((energyTotalWh * KCAL_PER_WH) / roundTripS) * 3600 : 0,
    maxOneWayM: Math.max(0, ((evaBudgetS - stopS) / 2) * v),
    withinBudget: roundTripS <= evaBudgetS && energyTotalWh <= consumablesWh,
    shelter: { windowS, maxSafeM, unsafeFromM, unsafeM: unsafeFromM === null ? 0 : total - unsafeFromM, unsafePath, boundary },
  }
}

/** How the rover route differs from the astronaut route for the same endpoints (for the "why it differs" note). */
export interface RouteDiff {
  /** share of the rover route points that lie within `corridorM` of the astronaut route */
  overlapPct: number
  lengthDiffM: number
  /** metres of the rover route that run on slopes above the astronaut limit */
  roverMetresAboveLimit: number
}

export function compareRoutes(
  astro: XZ[],
  rover: XZ[],
  slopeAt: (x: number, z: number) => number,
  astroLimitDeg: number,
  corridorM = 6,
): RouteDiff {
  let near = 0
  for (const p of rover) {
    for (const q of astro) {
      if (Math.hypot(p.x - q.x, p.z - q.z) <= corridorM) {
        near++
        break
      }
    }
  }
  let above = 0
  for (let i = 1; i < rover.length; i++) {
    const a = rover[i - 1]!
    const b = rover[i]!
    if (slopeAt(b.x, b.z) > astroLimitDeg) above += Math.hypot(b.x - a.x, b.z - a.z)
  }
  const len = (p: XZ[]) => p.reduce((s, q, i) => (i ? s + Math.hypot(q.x - p[i - 1]!.x, q.z - p[i - 1]!.z) : 0), 0)
  return { overlapPct: rover.length ? (near / rover.length) * 100 : 100, lengthDiffM: len(astro) - len(rover), roverMetresAboveLimit: above }
}
