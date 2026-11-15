import { describe, expect, it } from 'vitest'
import { ACTIONS } from '../contracts'
import { combineCost, costLayers, makeSyntheticTerrain } from '../nav/astar'
import { FLAG_BUMP, FLAG_EXPLORE, NO_ACTION, QLearner } from '../lab/qlearn'

function crop(n = 32, seed = 5) {
  const L = costLayers(makeSyntheticTerrain(n, seed), n, 1)
  const cost = combineCost(L, n, { ws: 4, wr: 0, maxSlope: 24 }, new Float32Array(n * n))
  let start = -1
  let goal = -1
  for (let i = 0; i < n * n; i++) {
    if (!Number.isFinite(cost[i]!)) continue
    if (start < 0) start = i
    else goal = i
  }
  return { n, cost, start, goal }
}
const mk = (seed = 7) => {
  const { n, cost, start, goal } = crop()
  return { n, cost, start, goal, l: new QLearner({ rows: n, cols: n, cost, start, goal, seed }) }
}

describe('traced episodes (Watch training)', () => {
  it('tracing does not change learning: same curve and Q-table as untraced runs', () => {
    const a = mk().l
    const b = mk().l
    const plain = a.runBatch(300, 100).curve
    const traced = b.runBatchSampled(300, { evalEvery: 100, sampleEvery: 7 }).curve
    expect(traced).toEqual(plain)
    expect(Array.from(b.q)).toEqual(Array.from(a.q))
  })

  it('a sample is internally consistent: steps, rewards, goal, neighbours and bumps', () => {
    const { n, l, goal } = mk()
    const { samples } = l.runBatchSampled(200, { sampleEvery: 1 })
    expect(samples).toHaveLength(200)
    for (const s of samples) {
      expect(s.cells.length).toBe(s.reward.length)
      expect(s.flags.length).toBe(s.reward.length)
      expect(s.cells.length).toBeLessThanOrEqual(400)
      let prev = s.start
      let sum = 0
      s.cells.forEach((c, i) => {
        const dr = Math.abs(Math.floor(c / n) - Math.floor(prev / n))
        const dc = Math.abs((c % n) - (prev % n))
        if (s.flags[i]! & FLAG_BUMP) expect(c).toBe(prev)
        else expect(Math.max(dr, dc)).toBe(1)
        sum += s.reward[i]!
        prev = c
      })
      expect(sum).toBeCloseTo(s.ret, 2)
      if (s.outcome === 'goal') expect(s.cells[s.cells.length - 1]).toBe(goal)
    }
  })

  it('samples every sampleEvery-th episode and always the last of the batch', () => {
    const { l } = mk()
    const { samples } = l.runBatchSampled(25, { sampleEvery: 10 })
    expect(samples.map((s) => s.episode)).toEqual([10, 20, 25])
  })

  it('sampled trajectories are deterministic for a seed, whatever the batch split', () => {
    const a = mk().l.runBatchSampled(60, { sampleEvery: 20 }).samples
    const l2 = mk().l
    const b = [...l2.runBatchSampled(25, { sampleEvery: 20 }).samples, ...l2.runBatchSampled(35, { sampleEvery: 20 }).samples]
    const pick = (xs: typeof a) => xs.filter((s) => s.episode % 20 === 0).map((s) => [s.episode, Array.from(s.cells), Array.from(s.reward)])
    expect(pick(b)).toEqual(pick(a))
  })

  it('marks exploratory moves with the explore flag, and the rate follows epsilon', () => {
    const { l } = mk()
    const { samples } = l.runBatchSampled(1, { sampleEvery: 1 })
    const s = samples[0]!
    expect(s.epsilon).toBe(1)
    const explored = Array.from(s.flags).filter((f) => f & FLAG_EXPLORE).length
    expect(explored).toBe(s.flags.length) // epsilon = 1: every move is a random one
  })

  it('sampleEvery 0 traces nothing', () => {
    expect(mk().l.runBatchSampled(10, { sampleEvery: 0 }).samples).toHaveLength(0)
  })

  it('caps the number of samples per batch', () => {
    const { l } = mk()
    const { samples } = l.runBatchSampled(100, { sampleEvery: 1, maxSamples: 5 })
    expect(samples).toHaveLength(5)
    expect(samples[samples.length - 1]!.episode).toBe(100) // the last one is always kept
  })
})

describe('policySnapshot', () => {
  it('reports value and best action per cell; blocked and unvisited cells have no action', () => {
    const { n, cost, l } = mk()
    l.runBatch(400)
    const { value, action } = l.policySnapshot()
    expect(value).toEqual(l.valueMap())
    for (let i = 0; i < n * n; i++) {
      const row = Array.from(l.q.slice(i * 8, i * 8 + 8))
      if (!Number.isFinite(cost[i]!) || row.every((v) => v === 0)) expect(action[i]).toBe(NO_ACTION)
      else expect(action[i]).toBe(row.indexOf(Math.max(...row)))
    }
    expect(ACTIONS.length).toBeGreaterThanOrEqual(8)
  })
})
