import { z } from 'zod'
import { astar, bottleneckSlope, combineCost, type CostLayers, type NoRouteCause } from './astar'
import { costWeightsSchema, profileIdSchema, type ProfileId } from './profiles'

/**
 * Worker-side planner. One instance per Worker (one Worker per profile). Holds the slope/roughness
 * layers and re-weights them per request, caching the combined cost until the weights change.
 * Framework-free so it is unit-testable in Node and wrappable by Comlink.
 */

const MAX_GRID = 4096

export const planRequestSchema = z
  .object({
    profileId: profileIdSchema,
    weights: costWeightsSchema,
    start: z.number().int().nonnegative(),
    goal: z.number().int().nonnegative(),
    /** metres per cell, used to report path length */
    resM: z.number().positive().max(1000).default(2),
  })
  .strict()
export type PlanRequest = z.input<typeof planRequestSchema>

export type PlanResult =
  | {
      status: 'ok'
      profileId: ProfileId
      /** flat cell indices (row * n + col), start first. Transferred, not copied. */
      path: Uint32Array
      /** sum of step length * mean cell cost (cost units) */
      cost: number
      lengthM: number
      expanded: number
      ms: number
    }
  | {
      status: 'no-route'
      profileId: ProfileId
      cause: NoRouteCause
      /** user-facing explanation (English) */
      message: string
      startSlopeDeg: number | null
      goalSlopeDeg: number | null
      maxSlopeDeg: number
      /** smallest slope limit that would connect the endpoints; null = unreachable at any slope */
      requiredSlopeDeg: number | null
      ms: number
    }

const fmt = (v: number | null) => (v === null || !Number.isFinite(v) ? 'unknown' : `${v.toFixed(1)}°`)

export class PlannerService {
  private n = 0
  private layers: CostLayers | null = null
  private cost: Float32Array | null = null
  private costKey = ''

  setLayers(n: number, slope: Float32Array, rough: Float32Array): void {
    if (!Number.isInteger(n) || n < 3 || n > MAX_GRID) throw new Error(`Invalid grid size ${n}`)
    if (!(slope instanceof Float32Array) || !(rough instanceof Float32Array)) throw new Error('Layers must be Float32Array')
    if (slope.length !== n * n || rough.length !== n * n) throw new Error('Layer length does not match grid size')
    this.n = n
    this.layers = { slope, rough }
    this.cost = new Float32Array(n * n)
    this.costKey = ''
  }

  plan(request: unknown): PlanResult {
    const req = planRequestSchema.parse(request)
    if (!this.layers || !this.cost) throw new Error('Layers not loaded')
    const t0 = performance.now()
    const { n } = this
    const { weights: w } = req
    const key = `${w.ws}|${w.wr}|${w.maxSlope}`
    if (key !== this.costKey) {
      combineCost(this.layers, n, w, this.cost)
      this.costKey = key
    }
    const r = astar(this.cost, n, n, req.start, req.goal)
    if (r.status === 'ok') {
      let lengthM = 0
      for (let i = 1; i < r.path.length; i++) {
        const a = r.path[i - 1]!
        const b = r.path[i]!
        const diag = (a % n !== b % n) && (((a / n) | 0) !== ((b / n) | 0))
        lengthM += diag ? Math.SQRT2 : 1
      }
      return {
        status: 'ok',
        profileId: req.profileId,
        path: r.path,
        cost: r.cost,
        lengthM: lengthM * req.resM,
        expanded: r.expanded,
        ms: performance.now() - t0,
      }
    }
    const slopeAt = (i: number) => {
      const v = this.layers!.slope[i]
      return i >= 0 && i < n * n && v !== undefined && Number.isFinite(v) ? v : null
    }
    const startSlopeDeg = slopeAt(req.start)
    const goalSlopeDeg = slopeAt(req.goal)
    let required: number | null = null
    if (r.cause !== 'out-of-bounds') {
      const b = bottleneckSlope(this.layers.slope, n, n, req.start, req.goal)
      required = Number.isFinite(b) ? b : null
    }
    return {
      status: 'no-route',
      profileId: req.profileId,
      cause: r.cause,
      message: explain(r.cause, { startSlopeDeg, goalSlopeDeg, max: w.maxSlope, required, r }),
      startSlopeDeg,
      goalSlopeDeg,
      maxSlopeDeg: w.maxSlope,
      requiredSlopeDeg: required,
      ms: performance.now() - t0,
    }
  }
}

function explain(
  cause: NoRouteCause,
  c: {
    startSlopeDeg: number | null
    goalSlopeDeg: number | null
    max: number
    required: number | null
    r: { startRegionCells?: number; goalRegionCells?: number }
  },
): string {
  switch (cause) {
    case 'out-of-bounds':
      return 'Start or goal lies outside the loaded terrain.'
    case 'start-blocked':
      return `The start cell is impassable (slope ${fmt(c.startSlopeDeg)}, limit ${c.max}°) or on the no-go margin.`
    case 'goal-blocked':
      return `The goal cell is impassable (slope ${fmt(c.goalSlopeDeg)}, limit ${c.max}°) or on the no-go margin.`
    case 'disconnected': {
      const need =
        c.required === null
          ? 'No slope limit connects them.'
          : `A slope limit of at least ${c.required.toFixed(1)}° would connect them (current ${c.max}°).`
      return `Terrain steeper than ${c.max}° separates start and goal. ${need}`
    }
  }
}
