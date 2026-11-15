import { describe, expect, it } from 'vitest'
import { astar, QLearner } from '@/intelligence'
import { buildQProblem, cellCost, DEFAULT_WEIGHTS } from './problem'
import { honestSummary, REFERENCE_OFFICIAL } from './reference'
import { compareVerdict, niceTicks, summarizeCurve } from './curve'

const flat = (n: number, v = 0) => new Float32Array(n * n).fill(v)

describe('Q problem', () => {
  it('blocks cells above the slope limit and prices the rest from the weights', () => {
    expect(cellCost(30, 0, 24, DEFAULT_WEIGHTS)).toBe(Infinity)
    expect(cellCost(0, 0, 24, DEFAULT_WEIGHTS)).toBeCloseTo(1)
    expect(cellCost(12, 0, 24, { time: 1, energy: 1, risk: 0 })).toBeCloseTo(1 + 3 * 0.5)
    expect(cellCost(12, 0, 24, { time: 1, energy: 0, risk: 0 })).toBeCloseTo(1)
    expect(cellCost(0, 0, 24, { time: 0, energy: 0, risk: 0 })).toBeGreaterThan(0)
  })
  it('crops and pools conservatively: a steep fine cell blocks its coarse cell', () => {
    const n = 192
    const slope = flat(n, 2)
    slope[96 * n + 96] = 40
    const p = buildQProblem({ n, slopeDeg: slope, roughM: flat(n), resM: 2, maxSlopeDeg: 24, weights: DEFAULT_WEIGHTS })!
    expect(p.rows).toBe(48)
    expect(p.factor).toBe(4)
    expect(p.cellM).toBe(8)
    expect(p.blocked).toBeGreaterThanOrEqual(1)
    expect(p.endpoints).toBe('default')
    expect(Number.isFinite(p.cost[p.start]!)).toBe(true)
    expect(Number.isFinite(p.cost[p.goal]!)).toBe(true)
  })
  it('uses the Mission endpoints when they fit in the crop', () => {
    const n = 200
    const o = 60 * n + 60
    const d = 100 * n + 110
    const p = buildQProblem({ n, slopeDeg: flat(n, 1), roughM: flat(n), resM: 2, maxSlopeDeg: 24, weights: DEFAULT_WEIGHTS, origin: o, destination: d })!
    expect(p.endpoints).toBe('mission')
    expect(p.start).not.toBe(p.goal)
  })
  it('returns null when there is no free cell for the endpoints', () => {
    const n = 100
    expect(buildQProblem({ n, slopeDeg: flat(n, 80), roughM: flat(n), resM: 2, maxSlopeDeg: 24, weights: DEFAULT_WEIGHTS })).toBeNull()
  })
  it('the learner trains on a built problem and approaches the A* optimum', () => {
    const n = 96
    const slope = flat(n, 3)
    for (let r = 20; r < 70; r++) slope[r * n + 48] = 40 // wall with a gap at the ends
    const p = buildQProblem({ n, slopeDeg: slope, roughM: flat(n), resM: 2, maxSlopeDeg: 24, weights: DEFAULT_WEIGHTS, size: 24 })!
    const q = new QLearner({ rows: p.rows, cols: p.cols, cost: p.cost, start: p.start, goal: p.goal, seed: 7, params: { epsilonDecay: 0.998, reward: { wShaping: 0.5 } } })
    q.runBatch(3000, 0)
    const ev = q.evaluate()
    const opt = astar(p.cost, p.rows, p.cols, p.start, p.goal)
    expect(opt.status).toBe('ok')
    expect(ev.reached).toBe(true)
    expect(ev.ratio!).toBeLessThan(1.3)
  })
})

describe('curve helpers', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => ({ episode: i + 1, ret: -100 + i / 10, steps: 10, reachedGoal: i > 500, epsilon: 0.5 }))
  it('buckets to at most maxPoints and keeps the last episode number', () => {
    const s = summarizeCurve(pts, 100)
    expect(s.length).toBeLessThanOrEqual(100)
    expect(s[s.length - 1]!.episode).toBe(1000)
    expect(s[0]!.success).toBe(0)
    expect(s[s.length - 1]!.success).toBe(1)
  })
  it('smooths with a trailing average', () => {
    const s = summarizeCurve([
      { episode: 1, ret: 0, steps: 1, reachedGoal: false, epsilon: 1 },
      { episode: 2, ret: 10, steps: 1, reachedGoal: true, epsilon: 1 },
    ])
    expect(s[1]!.smooth).toBe(5)
  })
  it('gives round tick values', () => {
    const t = niceTicks(-93, 12)
    expect(t.lo).toBeLessThanOrEqual(-93)
    expect(t.hi).toBeGreaterThanOrEqual(12)
    expect(t.ticks.every((v) => Number.isInteger(v) || Math.abs(v * 2 - Math.round(v * 2)) < 1e-9)).toBe(true)
  })
  it('words the comparison without overclaiming', () => {
    expect(compareVerdict(null)).toContain('Not evaluated')
    expect(compareVerdict({ reached: false, ratio: null })).toContain('does not reach')
    expect(compareVerdict({ reached: true, ratio: 1 })).toContain('Matches')
    expect(compareVerdict({ reached: true, ratio: 1.125 })).toBe('12.5% costlier than the A* optimum.')
  })
})

describe('reference policy honesty', () => {
  it('always puts the official result next to the in-distribution number and says it does not pass', () => {
    const h = honestSummary({ metrics: { successTest: 0.965, successTestCi95Low: 0.9295, testEpisodes: 200 } })
    expect(h.inDistribution).toContain('96.5%')
    expect(h.inDistribution).toContain('training distribution')
    expect(h.official).toContain('58.7%')
    expect(h.verdict).toBe('Does not pass L1: it needs at least 80%.')
    expect(REFERENCE_OFFICIAL.success).toBeLessThan(REFERENCE_OFFICIAL.threshold)
  })
  it('says No data when the card carries no metric', () => {
    expect(honestSummary({ metrics: {} }).inDistribution).toBe('No data')
  })
})
