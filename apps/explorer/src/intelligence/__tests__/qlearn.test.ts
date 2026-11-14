import { describe, expect, it } from 'vitest'
import { combineCost, costLayers, makeSyntheticTerrain } from '../nav/astar'
import { QLearner } from '../lab/qlearn'

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

describe('QLearner', () => {
  it('is deterministic for a fixed seed, independent of batch size', () => {
    const { n, cost, start, goal } = crop()
    const mk = () => new QLearner({ rows: n, cols: n, cost, start, goal, seed: 7 })
    const a = mk()
    const b = mk()
    const ca = a.runBatch(600, 100).curve
    const cb = [...b.runBatch(250, 100).curve, ...b.runBatch(350, 100).curve]
    expect(cb).toEqual(ca)
    expect(Array.from(a.q)).toEqual(Array.from(b.q))
  })

  it('different seeds diverge', () => {
    const { n, cost, start, goal } = crop()
    const a = new QLearner({ rows: n, cols: n, cost, start, goal, seed: 1 })
    const b = new QLearner({ rows: n, cols: n, cost, start, goal, seed: 2 })
    expect(a.runBatch(50).curve).not.toEqual(b.runBatch(50).curve)
  })

  it('converges close to the A* optimum', () => {
    const { n, cost, start, goal } = crop(32, 5)
    const l = new QLearner({ rows: n, cols: n, cost, start, goal, seed: 3, params: { epsilonDecay: 0.998 } })
    const { evals } = l.runBatch(6000, 500)
    const last = evals.at(-1)!
    expect(last.reached).toBe(true)
    expect(last.ratio!).toBeLessThan(1.15)
    expect(last.ratio!).toBeGreaterThanOrEqual(1 - 1e-6) // never better than the optimum
  })

  it('live parameter edits are validated and applied', () => {
    const { n, cost, start, goal } = crop()
    const l = new QLearner({ rows: n, cols: n, cost, start, goal, seed: 1 })
    l.setParams({ alpha: 0.5, reward: { goalReward: 50 } })
    expect(l.getParams().alpha).toBe(0.5)
    expect(l.getParams().reward.goalReward).toBe(50)
    expect(l.getParams().reward.invalidPenalty).toBe(5)
    expect(() => l.setParams({ alpha: 7 })).toThrow()
    expect(() => l.setParams({ gamma: Number.NaN })).toThrow()
  })

  it('rejects a blocked start or goal', () => {
    const { n, cost } = crop()
    expect(() => new QLearner({ rows: n, cols: n, cost, start: 0, goal: 40, seed: 1 })).toThrow()
  })
})
