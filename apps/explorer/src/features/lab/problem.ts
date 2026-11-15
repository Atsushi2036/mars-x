/**
 * Builds the small grid the live Q-learner trains on. Tabular Q-learning cannot handle a 1024 x 1024
 * grid in a browser tab, so the planning layers are cropped and downsampled to about 48 x 48 cells.
 * Pooling is conservative: a coarse cell is as steep as the steepest fine cell inside it.
 */
export interface RewardWeights {
  /** time: each step costs this much per cell travelled */
  time: number
  /** energy: climbing effort, grows with slope */
  energy: number
  /** risk: steep and rough ground */
  risk: number
}

export const DEFAULT_WEIGHTS: RewardWeights = { time: 1, energy: 1, risk: 1 }

export interface ProblemInput {
  /** planning layers (square grid, n x n) */
  n: number
  slopeDeg: Float32Array
  roughM: Float32Array
  /** metres per planning cell */
  resM: number
  /** slope limit of the profile (cells steeper than this are blocked) */
  maxSlopeDeg: number
  weights: RewardWeights
  /** flat cell indices on the planning grid, if the user placed them in Mission mode */
  origin?: number | null
  destination?: number | null
  /** target side of the learning grid */
  size?: number
}

export interface QProblem {
  rows: number
  cols: number
  /** per-cell traversal cost; Infinity = blocked */
  cost: Float32Array
  start: number
  goal: number
  /** fine cells per coarse cell */
  factor: number
  cellM: number
  /** where the endpoints came from */
  endpoints: 'mission' | 'default'
  /** how many coarse cells are blocked */
  blocked: number
}

/** Per-cell cost from the three reward weights. time = distance, energy = slope effort, risk = steepness and roughness. */
export function cellCost(slopeDeg: number, roughM: number, maxSlopeDeg: number, w: RewardWeights): number {
  if (!Number.isFinite(slopeDeg) || slopeDeg > maxSlopeDeg) return Infinity
  const s = slopeDeg / maxSlopeDeg
  const c = w.time + w.energy * 3 * s + w.risk * (3 * s * s * s + 2 * (Number.isFinite(roughM) ? roughM : 0))
  return Math.max(0.05, c)
}

function nearestPassable(cost: Float32Array, rows: number, cols: number, r0: number, c0: number): number {
  for (let d = 0; d < Math.max(rows, cols); d++) {
    for (let r = Math.max(0, r0 - d); r <= Math.min(rows - 1, r0 + d); r++) {
      for (let c = Math.max(0, c0 - d); c <= Math.min(cols - 1, c0 + d); c++) {
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== d) continue
        const v = cost[r * cols + c]!
        if (Number.isFinite(v) && v > 0) return r * cols + c
      }
    }
  }
  return -1
}

export function buildQProblem(i: ProblemInput): QProblem | null {
  const size = i.size ?? 48
  const { n } = i
  const o = i.origin ?? null
  const d = i.destination ?? null
  const have = o !== null && d !== null && o >= 0 && d >= 0
  const or = have ? Math.floor(o / n) : 0
  const oc = have ? o - or * n : 0
  const dr = have ? Math.floor(d / n) : 0
  const dc = have ? d - dr * n : 0
  const span = have ? Math.max(Math.abs(or - dr), Math.abs(oc - dc)) + 8 : size * 4
  const factor = Math.max(1, Math.min(Math.floor(n / size), Math.ceil(span / size)))
  const side = size * factor
  const cr = have ? Math.round((or + dr) / 2) : Math.floor(n / 2)
  const cc = have ? Math.round((oc + dc) / 2) : Math.floor(n / 2)
  const r0 = Math.max(0, Math.min(n - side, cr - Math.floor(side / 2)))
  const c0 = Math.max(0, Math.min(n - side, cc - Math.floor(side / 2)))
  const rows = size
  const cols = size
  const cost = new Float32Array(rows * cols)
  let blocked = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let s = 0
      let rough = 0
      for (let a = 0; a < factor; a++) {
        for (let b = 0; b < factor; b++) {
          const k = (r0 + r * factor + a) * n + (c0 + c * factor + b)
          s = Math.max(s, i.slopeDeg[k]!)
          rough += i.roughM[k]!
        }
      }
      const v = cellCost(s, rough / (factor * factor), i.maxSlopeDeg, i.weights)
      if (!Number.isFinite(v)) blocked++
      cost[r * cols + c] = v
    }
  }
  let start: number
  let goal: number
  let endpoints: QProblem['endpoints']
  const inCrop = (r: number, c: number) => r >= r0 && c >= c0 && r < r0 + side && c < c0 + side
  if (have && inCrop(or, oc) && inCrop(dr, dc)) {
    start = nearestPassable(cost, rows, cols, Math.floor((or - r0) / factor), Math.floor((oc - c0) / factor))
    goal = nearestPassable(cost, rows, cols, Math.floor((dr - r0) / factor), Math.floor((dc - c0) / factor))
    endpoints = 'mission'
  } else {
    start = nearestPassable(cost, rows, cols, Math.round(size * 0.15), Math.round(size * 0.15))
    goal = nearestPassable(cost, rows, cols, Math.round(size * 0.85), Math.round(size * 0.85))
    endpoints = 'default'
  }
  if (start < 0 || goal < 0 || start === goal) return null
  return { rows, cols, cost, start, goal, factor, cellM: i.resM * factor, endpoints, blocked }
}
