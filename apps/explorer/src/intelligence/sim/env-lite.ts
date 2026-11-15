import { z } from 'zod'
import { ACTIONS, OBS_DIM, PATCH_K } from '../contracts'
import { astronautStepEnergyWh, batteryCapacityWh, ENERGY, evaConsumablesWh, roverDriveEnergyWh, rtgPowerW } from './energy'

/**
 * "Env lite": single-episode TypeScript port of the NumPy dynamics in python/src/marsx/env/core.py
 * (NavBatch with N = 1). Used to build obs/1 for ONNX policies in the browser and to REPLAY run.json
 * trajectories, recomputing outcome/steps/energy rather than trusting the file. Same arithmetic, so
 * enumerated states match Python exactly and floats within float32 tolerance (golden traces:
 * __tests__/fixtures/env-golden.json). Scope = v0.1 of the Python env: geometry, energy, hidden
 * rocks with a range sensor; the lighting/comms features of obs/1 come from `envFeatures` (zeros
 * when absent, exactly like Python without a ConditionsHook).
 */

export const RISK_SLOPE_DEG = 15
const SOL_S = 88775.244
const P = PATCH_K >> 1
const WAIT = 8
const DIST = ACTIONS.map(([, dr, dc]) => Math.hypot(dr, dc))

/**
 * L2 conditions provider (python marsx.env.l2.MarsConditions). Dynamics only need `generationW`
 * (RTG / solar / none per agent kind, at the agent cell and time BEFORE the step); `features` and
 * `comm` fill the obs/1 environment and comm blocks.
 */
export interface ConditionsHook {
  generationW(kind: ParsedConfig['kind'], tS: number, row: number, col: number): number
  features(tS: number, row: number, col: number): ArrayLike<number>
  comm(tS: number): ArrayLike<number>
}

/** space-weather rule states (python marsx.conditions.spaceweather) */
const SPE_IDLE = 0
const SPE_ACTIVE = 1
const SPE_SAFE = 2
const SPE_VIOLATED = 3

export interface Terrain {
  rows: number
  cols: number
  resM: number
  /** degrees, NaN = nodata */
  slope: Float32Array
  /** m, NaN = nodata */
  step: Float32Array
  /** m, NaN = nodata */
  height: Float32Array
}

export const envConfigSchema = z
  .object({
    kind: z.enum(['rtg_rover', 'solar_rover', 'astronaut']),
    maxSlopeDeg: z.number().positive().max(90),
    maxStepM: z.number().positive().max(10),
    speedMS: z.number().positive().max(100),
    gravity: z.number().positive().max(30),
    reward: z
      .object({
        energy: z.number(),
        risk: z.number(),
        time: z.number(),
        progress: z.number(),
        goal: z.number(),
        failure: z.number(),
        hazardAttempt: z.number(),
        stepCost: z.number(),
      })
      .strict(),
    maxSteps: z.number().int().positive().max(20_000),
    energyOn: z.boolean(),
    sensorRadiusM: z.number().min(0).max(1000),
    waitS: z.number().positive().max(86_400),
    sols: z.number().positive().nullable(),
    /** space-weather shelter rule (astronaut only); omitted = disabled */
    spe: z.object({ enabled: z.boolean(), windowS: z.number().positive().max(86_400) }).strict().default({ enabled: false, windowS: 1800 }),
  })
  .strict()
export type EnvConfig = z.input<typeof envConfigSchema>
type ParsedConfig = z.output<typeof envConfigSchema>

export type Outcome = '' | 'success' | 'collision' | 'battery' | 'spe_violation' | 'timeout'

export interface StepResult {
  reward: number
  terminated: boolean
  truncated: boolean
  outcome: Outcome
}

export interface EnvState {
  row: number
  col: number
  tS: number
  soc: number
  energyWh: number
  pathM: number
  pathCost: number
  steps: number
  violations: number
  timeSlopeGt15S: number
  shield: number
  outcome: Outcome
  /** 0 idle, 1 alert active, 2 safe, 3 violated (astronaut with the shelter rule) */
  speState: number
  goalRow: number
  goalCol: number
}

/** Same cost model as marsx.env.terrain.cost_map + marsx.nav.costmap.cost_from_slope (slope weight 4). */
export function costMap(t: Terrain, maxSlopeDeg: number, maxStepM: number, slopeWeight = 4): Float32Array {
  const out = new Float32Array(t.rows * t.cols)
  for (let i = 0; i < out.length; i++) {
    const s = t.slope[i]!
    const blocked = !Number.isFinite(t.step[i]!) || t.step[i]! > maxStepM || !Number.isFinite(t.height[i]!)
    out[i] = blocked || !Number.isFinite(s) || s > maxSlopeDeg ? Infinity : 1 + slopeWeight * (s / maxSlopeDeg) ** 2
  }
  return out
}

export class EnvLite {
  readonly cost: Float32Array
  private readonly rows: number
  private readonly cols: number
  private readonly resM: number
  private readonly height: Float32Array
  private readonly slope: Float32Array
  private readonly rocks: Uint8Array
  private readonly capacityWh: number
  private readonly rechargeW: number
  private readonly idleW: number
  private alertT = Number.NaN
  private shelterRow = 0
  private shelterCol = 0
  private readonly sensor: Float32Array
  private row = 0
  private col = 0
  private goalRow = 0
  private goalCol = 0
  private heading = 0
  private s: EnvState

  constructor(
    terrain: Terrain,
    config: EnvConfig,
    rocks?: Uint8Array,
    /** L2 conditions; without it the env behaves like python with conditions=None */
    private readonly conditions?: ConditionsHook,
  ) {
    this.cfg = envConfigSchema.parse(config)
    const { rows, cols } = terrain
    if (terrain.slope.length !== rows * cols || terrain.step.length !== rows * cols || terrain.height.length !== rows * cols) {
      throw new Error('terrain layers do not match rows*cols')
    }
    if (rocks && rocks.length !== rows * cols) throw new Error('rocks mask does not match rows*cols')
    this.rows = rows
    this.cols = cols
    this.resM = terrain.resM
    this.cost = costMap(terrain, this.cfg.maxSlopeDeg, this.cfg.maxStepM)
    this.rocks = rocks ?? new Uint8Array(rows * cols)
    // height: nodata -> mean of finite heights (python: edge-padded afterwards, equivalent to clamping)
    let sum = 0
    let cnt = 0
    for (const v of terrain.height) {
      if (!Number.isFinite(v)) continue
      sum += v
      cnt++
    }
    const mean = cnt ? sum / cnt : 0
    this.height = Float32Array.from(terrain.height, (v) => (Number.isFinite(v) ? v : mean))
    this.slope = Float32Array.from(terrain.slope, (v) => (Number.isFinite(v) ? v : 90))
    this.capacityWh = this.cfg.kind === 'astronaut' ? evaConsumablesWh() : batteryCapacityWh()
    this.rechargeW = this.cfg.kind === 'rtg_rover' ? rtgPowerW(0) : 0
    this.idleW = this.cfg.kind === 'astronaut' ? ENERGY.metRateLowW : ENERGY.baseLoadW
    this.sensor = new Float32Array(PATCH_K * PATCH_K)
    for (let oy = -P; oy <= P; oy++) {
      for (let ox = -P; ox <= P; ox++) this.sensor[(oy + P) * PATCH_K + ox + P] = Math.hypot(oy, ox) * this.resM <= this.cfg.sensorRadiusM ? 1 : 0
    }
    this.s = this.blankState()
  }
  readonly cfg: ParsedConfig

  private blankState(): EnvState {
    return { row: 0, col: 0, tS: 0, soc: 1, energyWh: 0, pathM: 0, pathCost: 0, steps: 0, violations: 0, timeSlopeGt15S: 0, shield: 0, outcome: '', speState: SPE_IDLE, goalRow: 0, goalCol: 0 }
  }

  get state(): Readonly<EnvState> {
    return { ...this.s, row: this.row, col: this.col, goalRow: this.goalRow, goalCol: this.goalCol }
  }

  /**
   * `alertTS`: scripted space-weather alert time of this episode (undefined = none). Python draws it from the
   * episode RNG, which the web does not replicate, so it has to come from the run (event `speAlert`).
   * `initialSoc`: starting battery/consumables level (default 1).
   */
  reset(start: readonly [number, number], goal: readonly [number, number], opts: { alertTS?: number; initialSoc?: number } = {}): Float32Array {
    const { alertTS, initialSoc } = opts
    for (const [r, c] of [start, goal] as const) {
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= this.rows || c >= this.cols) throw new Error('start/goal outside the grid')
    }
    this.row = start[0]
    this.col = start[1]
    this.goalRow = goal[0]
    this.goalCol = goal[1]
    this.heading = 0
    this.s = this.blankState()
    if (initialSoc !== undefined) this.s.soc = Math.fround(initialSoc)
    this.shelterRow = start[0]
    this.shelterCol = start[1]
    this.alertT = this.cfg.kind === 'astronaut' && this.cfg.spe.enabled && alertTS !== undefined ? alertTS : Number.NaN
    return this.observe()
  }

  private at(r: number, c: number): number {
    return r * this.cols + c
  }
  private inGrid(r: number, c: number) {
    return r >= 0 && c >= 0 && r < this.rows && c < this.cols
  }
  private costAt(r: number, c: number) {
    return this.inGrid(r, c) ? this.cost[this.at(r, c)]! : Infinity
  }
  /** edge-padded height */
  private heightAt(r: number, c: number) {
    return this.height[this.at(Math.min(Math.max(r, 0), this.rows - 1), Math.min(Math.max(c, 0), this.cols - 1))]!
  }
  private slopeAt(r: number, c: number) {
    return this.inGrid(r, c) ? this.slope[this.at(r, c)]! : 90
  }
  private rockAt(r: number, c: number) {
    return this.inGrid(r, c) && this.rocks[this.at(r, c)] === 1
  }

  /** obs/1 flat vector (float32, length 505). */
  observe(): Float32Array {
    const out = new Float32Array(OBS_DIM)
    const K2 = PATCH_K * PATCH_K
    const h0 = this.heightAt(this.row, this.col)
    for (let oy = -P; oy <= P; oy++) {
      for (let ox = -P; ox <= P; ox++) {
        const k = (oy + P) * PATCH_K + ox + P
        const r = this.row + oy
        const c = this.col + ox
        const cost = this.costAt(r, c)
        const blocked = !Number.isFinite(cost)
        out[k] = blocked ? 1 : Math.min(Math.max((cost - 1) / 4, 0), 1)
        out[K2 + k] = blocked ? 1 : 0
        out[2 * K2 + k] = Math.min(Math.max((this.heightAt(r, c) - h0) / 5, -1), 1)
        out[3 * K2 + k] = this.rockAt(r, c) ? this.sensor[k]! : 0
      }
    }
    const dr = this.goalRow - this.row
    const dc = this.goalCol - this.col
    const d = Math.hypot(dr, dc)
    const safe = d > 0 ? d : 1
    const clip = (x: number) => Math.min(Math.max(x, -1), 1)
    out[484] = clip(dr / 64)
    out[485] = clip(dc / 64)
    out[486] = clip(dr / safe)
    out[487] = clip(dc / safe)
    const hd = Math.fround(this.heading)
    out[488] = this.s.soc
    out[489] = 0
    out[490] = Math.sin(hd)
    out[491] = Math.cos(hd)
    if (this.conditions) {
      const f = this.conditions.features(this.s.tS, this.row, this.col)
      for (let i = 0; i < 8; i++) out[492 + i] = f[i] ?? 0
      const cm = this.conditions.comm(this.s.tS)
      for (let i = 0; i < 3; i++) out[500 + i] = cm[i] ?? 0
    } else {
      out[500] = 1 // link available (python without conditions)
    }
    const sols = this.cfg.sols
    out[503] = sols === null ? 1 : Math.min(Math.max(1 - this.s.tS / (sols * SOL_S), 0), 1)
    out[504] = Math.min(Math.max(1 - this.s.steps / this.cfg.maxSteps, 0), 1)
    return out
  }

  /** python marsx.conditions.spaceweather.update for one agent (sticky SAFE / VIOLATED). */
  private speUpdate(state: number, t: number, inShelter: boolean, windowS: number): number {
    if (state !== SPE_IDLE && state !== SPE_ACTIVE) return state
    const alert = this.alertT
    if (Number.isNaN(alert) || t < alert) return state
    const late = t > alert + windowS
    if (inShelter && !late) return SPE_SAFE
    return late ? SPE_VIOLATED : SPE_ACTIVE
  }

  private gdist(r: number, c: number) {
    return Math.hypot(this.goalRow - r, this.goalCol - c)
  }

  /** Same order of effects as NavBatch.step. Throws on an invalid action; ignores steps once done. */
  step(action: number): StepResult {
    if (!Number.isInteger(action) || action < 0 || action > 8) throw new Error(`invalid action ${action}`)
    if (this.s.outcome !== '') return { reward: 0, terminated: false, truncated: false, outcome: this.s.outcome }
    const { cfg } = this
    const w = cfg.reward
    const [, mr, mc] = ACTIONS[action]!
    const wait = action === WAIT
    const tr = this.row + mr
    const tc = this.col + mc
    // no corner cutting, like marsx.nav (python env since 2c8b04c)
    const corner = mr !== 0 && mc !== 0 && (!Number.isFinite(this.costAt(this.row + mr, this.col)) || !Number.isFinite(this.costAt(this.row, this.col + mc)))
    const blocked = !wait && (!Number.isFinite(this.costAt(tr, tc)) || corner)
    const rock = !wait && !blocked && this.rockAt(tr, tc)
    const moved = !wait && !blocked && !rock
    const nr = moved ? tr : this.row
    const nc = moved ? tc : this.col
    const costInc = moved ? DIST[action]! * 0.5 * Math.fround(this.costAt(this.row, this.col) + this.costAt(tr, tc)) : 0
    const distM = moved ? DIST[action]! * this.resM : 0
    const dt = moved ? distM / cfg.speedMS : wait ? cfg.waitS : 0
    const rise = Math.fround(this.heightAt(nr, nc) - this.heightAt(this.row, this.col))
    const slopeSigned = moved ? Math.fround(Math.sign(rise) * this.slopeAt(nr, nc)) : 0
    const eWh =
      (moved
        ? cfg.kind === 'astronaut'
          ? astronautStepEnergyWh(distM, slopeSigned)
          : roverDriveEnergyWh(distM, slopeSigned, cfg.gravity)
        : 0) + (wait ? (this.idleW * dt) / 3600 : 0)
    // generation: agent cell and time BEFORE the step (python conditions.generation_w(t_s, rc0))
    const genWh = this.conditions
      ? (this.conditions.generationW(cfg.kind, this.s.tS, this.row, this.col) * dt) / 3600
      : (this.rechargeW * dt) / 3600
    const progress = this.gdist(this.row, this.col) - this.gdist(nr, nc)
    if (moved) this.heading = Math.atan2(mc, -mr)
    this.row = nr
    this.col = nc
    const s = this.s
    s.tS += dt
    s.steps += 1
    s.pathM += distM
    s.pathCost += costInc
    s.energyWh += eWh
    const steep = this.slopeAt(nr, nc) > RISK_SLOPE_DEG
    if (moved && steep) s.timeSlopeGt15S += dt
    if (rock) s.violations += 1
    if (blocked) s.shield += 1
    if (cfg.energyOn) {
      const delta = (genWh - eWh) / this.capacityWh
      s.soc = Math.fround(Math.min(Math.max(s.soc + delta, 0), 1))
    }
    let speViol = false
    if (cfg.kind === 'astronaut' && cfg.spe.enabled) {
      const prev = s.speState
      s.speState = this.speUpdate(s.speState, s.tS, nr === this.shelterRow && nc === this.shelterCol, cfg.spe.windowS)
      if (prev === SPE_IDLE && s.speState !== SPE_IDLE) {
        this.goalRow = this.shelterRow // the alert redirects the goal to the shelter
        this.goalCol = this.shelterCol
      }
      speViol = s.speState === SPE_VIOLATED
    }
    const reached = nr === this.goalRow && nc === this.goalCol && !speViol
    const battery = s.soc <= 0 && !reached
    const terminated = reached || rock || battery || speViol
    const truncated = s.steps >= cfg.maxSteps && !terminated
    s.outcome = reached ? 'success' : rock ? 'collision' : speViol ? 'spe_violation' : battery ? 'battery' : truncated ? 'timeout' : ''
    const reward =
      -w.stepCost * costInc +
      w.progress * progress -
      w.hazardAttempt * (blocked ? 1 : 0) -
      (w.time * dt) / 600 -
      (w.energy * eWh) / 100 -
      w.risk * (steep && moved ? 1 : 0) +
      w.goal * (reached ? 1 : 0) -
      w.failure * (rock || battery || speViol ? 1 : 0)
    return { reward: Math.fround(reward), terminated, truncated, outcome: s.outcome }
  }
}
