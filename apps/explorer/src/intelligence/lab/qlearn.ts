import { z } from 'zod'
import { ACTIONS } from '../contracts'
import { astar } from '../nav/search'

/**
 * Tabular Q-learning on a cost crop, run live in a Worker. Deterministic given (config, seed): the
 * RNG stream does not depend on how episodes are batched, so the UI may call runBatch() in any
 * chunk size. Hyper-parameters and reward weights are editable between batches via setParams().
 * Spike: 64x64, 1.2 % over the A* optimum in 0.26 s.
 *
 * Moves are the 8 act/1 movement actions (indices 0..7; WAIT is not used by the grid learner).
 */

const MOVES = ACTIONS.slice(0, 8)
const SQ2 = Math.SQRT2

export const qParamsSchema = z
  .object({
    alpha: z.number().min(0.001).max(1),
    gamma: z.number().min(0).max(1),
    epsilonStart: z.number().min(0).max(1),
    epsilonMin: z.number().min(0).max(1),
    /** multiplicative decay per episode */
    epsilonDecay: z.number().min(0.5).max(1),
    maxStepsPerEpisode: z.number().int().min(1).max(100_000),
    exploringStarts: z.boolean(),
    reward: z
      .object({
        /** multiplies the traversal cost of each step (energy/risk proxy) */
        wCost: z.number().min(0).max(100),
        /** extra penalty for bumping into a blocked cell / edge (move not executed) */
        invalidPenalty: z.number().min(0).max(1000),
        goalReward: z.number().min(0).max(10_000),
        /** potential-based shaping on -euclidean distance to goal (design 1.5 w_p) */
        wShaping: z.number().min(0).max(100),
      })
      .strict(),
  })
  .strict()
export type QParams = z.infer<typeof qParamsSchema>

export const DEFAULT_QPARAMS: QParams = {
  alpha: 0.2,
  gamma: 0.995,
  epsilonStart: 1,
  epsilonMin: 0.05,
  epsilonDecay: 0.9995,
  maxStepsPerEpisode: 400,
  exploringStarts: true,
  reward: { wCost: 1, invalidPenalty: 5, goalReward: 100, wShaping: 0 },
}

export interface QSetup {
  rows: number
  cols: number
  /** per-cell cost, Infinity/NaN/<=0 = blocked (same convention as the planner) */
  cost: Float32Array
  start: number
  goal: number
  seed: number
  params?: Partial<Omit<QParams, 'reward'>> & { reward?: Partial<QParams['reward']> }
}

export interface EpisodePoint {
  episode: number
  /** undiscounted return */
  ret: number
  steps: number
  reachedGoal: boolean
  epsilon: number
}

/** Step flags of a traced episode. */
export const FLAG_BUMP = 1 // the move was not executed (blocked cell or map edge)
export const FLAG_EXPLORE = 2 // the action was a random one (epsilon), not the greedy one
/** Marker in policySnapshot().action for cells with no learned preference (blocked or never updated). */
export const NO_ACTION = 255

export type EpisodeOutcome = 'goal' | 'timeout'

/** One episode, step by step, for the Watch training view. All arrays have one entry per step. */
export interface EpisodeSample {
  episode: number
  /** epsilon used during this episode */
  epsilon: number
  outcome: EpisodeOutcome
  /** cell where the episode began */
  start: number
  /** cell after each step (equal to the previous one when the move bumped) */
  cells: Uint32Array
  /** reward of each step (the goal reward is included in the last step) */
  reward: Float32Array
  /** FLAG_BUMP | FLAG_EXPLORE per step */
  flags: Uint8Array
  /** undiscounted return */
  ret: number
}

export interface SampledBatch extends BatchResult {
  samples: EpisodeSample[]
}

export interface GreedyEval {
  episode: number
  reached: boolean
  /** traversal cost of the greedy path (same units as A* cost) */
  pathCost: number
  /** pathCost / A* optimum (1 = optimal); null if the greedy policy does not reach the goal */
  ratio: number | null
}

export interface BatchResult {
  curve: EpisodePoint[]
  /** evaluations done inside this batch (every `evalEvery` episodes) */
  evals: GreedyEval[]
  episodes: number
}

/** mulberry32: tiny, fast, well-distributed 32-bit PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Trace {
  cells: number[]
  reward: number[]
  flags: number[]
}

const passable = (v: number) => Number.isFinite(v) && v > 0

export class QLearner {
  readonly rows: number
  readonly cols: number
  readonly q: Float32Array
  private cost: Float32Array
  private free: Int32Array
  private start: number
  private goal: number
  private params: QParams
  private rnd: () => number
  private episode = 0
  private epsilon: number
  /** A* optimum on the same cost grid, Infinity if unreachable */
  readonly optimum: number

  constructor(setup: QSetup) {
    const { rows, cols, cost } = setup
    if (cost.length !== rows * cols) throw new Error('cost length does not match grid')
    if (rows * cols > 1_000_000) throw new Error('grid too large for the live learner')
    this.rows = rows
    this.cols = cols
    this.cost = cost
    this.start = setup.start
    this.goal = setup.goal
    if (!passable(cost[setup.start]!) || !passable(cost[setup.goal]!)) throw new Error('start or goal is blocked')
    this.params = qParamsSchema.parse({
      ...DEFAULT_QPARAMS,
      ...setup.params,
      reward: { ...DEFAULT_QPARAMS.reward, ...setup.params?.reward },
    })
    this.epsilon = this.params.epsilonStart
    this.rnd = mulberry32(setup.seed)
    this.q = new Float32Array(rows * cols * 8)
    const free: number[] = []
    for (let i = 0; i < cost.length; i++) if (passable(cost[i]!)) free.push(i)
    this.free = Int32Array.from(free)
    const opt = astar(cost, rows, cols, setup.start, setup.goal)
    this.optimum = opt.status === 'ok' ? opt.cost : Infinity
  }

  getParams(): QParams {
    return structuredClone(this.params)
  }

  /** Edit hyper-parameters / reward weights live (takes effect from the next episode). */
  setParams(patch: Partial<Omit<QParams, 'reward'>> & { reward?: Partial<QParams['reward']> }): void {
    this.params = qParamsSchema.parse({
      ...this.params,
      ...patch,
      reward: { ...this.params.reward, ...patch.reward },
    })
  }

  /** One environment transition. Returns [next, reward, stepCost, moved]. */
  private step(u: number, a: number): [number, number, number, boolean] {
    const { rows, cols, cost } = this
    const m = MOVES[a]!
    const ur = (u / cols) | 0
    const uc = u - ur * cols
    const vr = ur + m[1]
    const vc = uc + m[2]
    const r = this.params.reward
    if (vr < 0 || vc < 0 || vr >= rows || vc >= cols) return [u, -r.invalidPenalty, 0, false]
    const v = vr * cols + vc
    const diag = m[1] !== 0 && m[2] !== 0
    if (!passable(cost[v]!) || (diag && (!passable(cost[ur * cols + vc]!) || !passable(cost[vr * cols + uc]!)))) {
      return [u, -r.invalidPenalty, 0, false]
    }
    const stepCost = (diag ? SQ2 : 1) * 0.5 * (cost[u]! + cost[v]!)
    let reward = -r.wCost * stepCost
    if (r.wShaping > 0) {
      const gr = (this.goal / cols) | 0
      const gc = this.goal - gr * cols
      const phi = (rr: number, cc: number) => -Math.hypot(rr - gr, cc - gc)
      reward += r.wShaping * (this.params.gamma * phi(vr, vc) - phi(ur, uc))
    }
    return [v, reward, stepCost, true]
  }

  private bestAction(u: number): number {
    const q = this.q
    const o = u * 8
    let a = 0
    for (let k = 1; k < 8; k++) if (q[o + k]! > q[o + a]!) a = k
    return a
  }

  runEpisode(): EpisodePoint {
    return this.playEpisode(null).point
  }

  /** Same episode as runEpisode() (identical RNG stream and updates) while recording every step. */
  runEpisodeTraced(): { point: EpisodePoint; sample: EpisodeSample } {
    const t: Trace = { cells: [], reward: [], flags: [] }
    const { point, start } = this.playEpisode(t)
    return {
      point,
      sample: {
        episode: point.episode,
        epsilon: point.epsilon,
        outcome: point.reachedGoal ? 'goal' : 'timeout',
        start,
        cells: Uint32Array.from(t.cells),
        reward: Float32Array.from(t.reward),
        flags: Uint8Array.from(t.flags),
        ret: point.ret,
      },
    }
  }

  private playEpisode(trace: Trace | null): { point: EpisodePoint; start: number } {
    const { alpha, gamma, maxStepsPerEpisode, exploringStarts, reward } = this.params
    const q = this.q
    let u = exploringStarts ? this.free[(this.rnd() * this.free.length) | 0]! : this.start
    const begin = u
    let ret = 0
    let steps = 0
    let reached = false
    while (steps < maxStepsPerEpisode) {
      if (u === this.goal) {
        reached = true
        break
      }
      const explore = this.rnd() < this.epsilon
      const a = explore ? (this.rnd() * 8) | 0 : this.bestAction(u)
      const [v, r0, , moved] = this.step(u, a)
      const done = v === this.goal
      const r = done ? r0 + reward.goalReward : r0
      let m = 0
      if (!done) {
        const o = v * 8
        m = q[o]!
        for (let k = 1; k < 8; k++) if (q[o + k]! > m) m = q[o + k]!
      }
      const i = u * 8 + a
      q[i] = q[i]! + alpha * (r + gamma * m - q[i]!)
      ret += r
      steps++
      if (trace) {
        trace.cells.push(v)
        trace.reward.push(r)
        trace.flags.push((moved ? 0 : FLAG_BUMP) | (explore ? FLAG_EXPLORE : 0))
      }
      u = v
      if (done) reached = true
    }
    this.episode++
    const point = { episode: this.episode, ret, steps, reachedGoal: reached, epsilon: this.epsilon }
    this.epsilon = Math.max(this.params.epsilonMin, this.epsilon * this.params.epsilonDecay)
    return { point, start: begin }
  }

  /** Greedy rollout from the fixed start; path of flat cell indices (loops/blocks => not reached). */
  greedyPath(): { path: Uint32Array; reached: boolean; pathCost: number } {
    const cells: number[] = [this.start]
    const seen = new Set<number>([this.start])
    let u = this.start
    let total = 0
    for (let t = 0; t < 4 * Math.max(this.rows, this.cols) + 16 && u !== this.goal; t++) {
      const [v, , sc, moved] = this.step(u, this.bestAction(u))
      if (!moved || seen.has(v)) return { path: Uint32Array.from(cells), reached: false, pathCost: Infinity }
      total += sc
      seen.add(v)
      cells.push(v)
      u = v
    }
    const reached = u === this.goal
    return { path: Uint32Array.from(cells), reached, pathCost: reached ? total : Infinity }
  }

  evaluate(): GreedyEval {
    const g = this.greedyPath()
    return {
      episode: this.episode,
      reached: g.reached,
      pathCost: g.pathCost,
      ratio: g.reached && Number.isFinite(this.optimum) && this.optimum > 0 ? g.pathCost / this.optimum : g.reached ? 1 : null,
    }
  }

  /** Run `n` episodes; greedy evaluation every `evalEvery` episodes (0 = never). */
  runBatch(n: number, evalEvery = 100): BatchResult {
    const curve: EpisodePoint[] = []
    const evals: GreedyEval[] = []
    for (let i = 0; i < n; i++) {
      curve.push(this.runEpisode())
      if (evalEvery > 0 && this.episode % evalEvery === 0) evals.push(this.evaluate())
    }
    return { curve, evals, episodes: this.episode }
  }

  /**
   * Like runBatch, plus trajectories for the Watch view: every sampleEvery-th episode and always the last one of
   * the batch (at most maxSamples, keeping the newest). Sampling never changes the learning.
   */
  runBatchSampled(n: number, opts: { evalEvery?: number; sampleEvery: number; maxSamples?: number }): SampledBatch {
    const evalEvery = opts.evalEvery ?? 100
    const curve: EpisodePoint[] = []
    const evals: GreedyEval[] = []
    let samples: EpisodeSample[] = []
    for (let i = 0; i < n; i++) {
      const next = this.episode + 1
      const keep = opts.sampleEvery > 0 && (next % opts.sampleEvery === 0 || i === n - 1)
      if (keep) {
        const { point, sample } = this.runEpisodeTraced()
        curve.push(point)
        samples.push(sample)
      } else curve.push(this.runEpisode())
      if (evalEvery > 0 && this.episode % evalEvery === 0) evals.push(this.evaluate())
    }
    if (opts.maxSamples !== undefined && samples.length > opts.maxSamples) samples = samples.slice(-opts.maxSamples)
    return { curve, evals, episodes: this.episode, samples }
  }

  /** What the agent has learned so far: V(s) = max_a Q and the best action per cell (NO_ACTION if none). */
  policySnapshot(): { value: Float32Array; action: Uint8Array } {
    const value = this.valueMap()
    const action = new Uint8Array(this.rows * this.cols)
    for (let i = 0; i < action.length; i++) {
      let any = false
      for (let k = 0; k < 8; k++) if (this.q[i * 8 + k] !== 0) any = true
      action[i] = passable(this.cost[i]!) && any ? this.bestAction(i) : NO_ACTION
    }
    return { value, action }
  }

  /** State-value map max_a Q for the heat overlay (Float32, one per cell; -Infinity-free). */
  valueMap(): Float32Array {
    const out = new Float32Array(this.rows * this.cols)
    for (let i = 0; i < out.length; i++) {
      let m = -Infinity
      for (let k = 0; k < 8; k++) m = Math.max(m, this.q[i * 8 + k]!)
      out[i] = Number.isFinite(m) ? m : 0
    }
    return out
  }
}
