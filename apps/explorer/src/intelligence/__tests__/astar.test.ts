import { describe, expect, it } from 'vitest'
import golden from './fixtures/nav-golden.json'
import { astar, bottleneckSlope, combineCost, costLayers, makeSyntheticTerrain } from '../nav/astar'

interface GoldenCase {
  n: number
  weights: { ws: number; wr: number; maxSlope: number }
  cost: (number | null)[]
  queries: { start: number; goal: number; cost: number | null }[]
}

describe('A* parity with the spike golden cases', () => {
  for (const c of golden as GoldenCase[]) {
    it(`n=${c.n}: ${c.queries.length} queries match the reference cost`, () => {
      const cost = Float32Array.from(c.cost, (v) => (v === null ? Infinity : v))
      for (const q of c.queries) {
        const r = astar(cost, c.n, c.n, q.start, q.goal)
        if (q.cost === null) {
          expect(r.status).toBe('no-route')
        } else {
          expect(r.status).toBe('ok')
          if (r.status === 'ok') expect(Math.abs(r.cost - q.cost)).toBeLessThan(1e-6)
        }
      }
    })
  }
})

describe('A* semantics', () => {
  const free = (n: number) => new Float32Array(n * n).fill(1)

  it('returns a path of cell indices from start to goal', () => {
    const r = astar(free(8), 8, 8, 0, 63)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.path[0]).toBe(0)
    expect(r.path[r.path.length - 1]).toBe(63)
    expect(r.path.length).toBe(8) // pure diagonal
    expect(r.cost).toBeCloseTo(7 * Math.SQRT2, 6)
  })

  it('start === goal is a zero-cost single-cell path', () => {
    const r = astar(free(4), 4, 4, 5, 5)
    expect(r).toMatchObject({ status: 'ok', cost: 0 })
  })

  it('does not cut blocked corners', () => {
    const c = free(3)
    c[1] = Infinity
    c[3] = Infinity
    expect(astar(c, 3, 3, 0, 8).status).toBe('no-route')
  })

  it('reports out-of-bounds, blocked start and blocked goal with a cause', () => {
    const c = free(4)
    c[0] = Infinity
    c[15] = Infinity
    expect(astar(c, 4, 4, 99, 5)).toMatchObject({ status: 'no-route', cause: 'out-of-bounds' })
    expect(astar(c, 4, 4, 0, 5)).toMatchObject({ status: 'no-route', cause: 'start-blocked' })
    expect(astar(c, 4, 4, 5, 15)).toMatchObject({ status: 'no-route', cause: 'goal-blocked' })
  })

  it('reports a wall as disconnected with region sizes', () => {
    const n = 8
    const c = free(n)
    for (let y = 0; y < n; y++) c[y * n + 4] = Infinity
    const r = astar(c, n, n, 0, 7)
    expect(r.status).toBe('no-route')
    if (r.status === 'no-route') {
      expect(r.cause).toBe('disconnected')
      expect(r.startRegionCells).toBe(32)
      expect(r.goalRegionCells).toBe(24)
    }
  })

  it('bottleneckSlope finds the minimum slope limit that connects the endpoints', () => {
    const n = 8
    const slope = new Float32Array(n * n).fill(5)
    for (let y = 0; y < n; y++) slope[y * n + 4] = 27
    expect(bottleneckSlope(slope, n, n, 0, 7)).toBeCloseTo(27, 5)
  })
})

describe('cost layers', () => {
  it('re-weighting blocks the border and cells above maxSlope', () => {
    const n = 32
    const L = costLayers(makeSyntheticTerrain(n, 3), n, 1)
    const cost = combineCost(L, n, { ws: 4, wr: 10, maxSlope: 24 }, new Float32Array(n * n))
    expect(cost[0]).toBe(Infinity)
    const lax = combineCost(L, n, { ws: 4, wr: 10, maxSlope: 90 }, new Float32Array(n * n))
    let blocked = 0
    for (const v of lax) if (v === Infinity) blocked++
    expect(blocked).toBe(4 * n - 4)
  })
})
