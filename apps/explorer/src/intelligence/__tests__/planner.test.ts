import { describe, expect, it } from 'vitest'
import { combineCost, costLayers, makeSyntheticTerrain } from '../nav/astar'
import { PlannerService } from '../nav/planner-service'
import { PlannerPool, type PlannerHandle } from '../nav/planner-pool'
import { PROFILES as P } from '../nav/profiles'

const W = (id: keyof typeof P) => ({ ws: P[id].ws, wr: P[id].wr, maxSlope: P[id].maxSlope })
const PROFILES = P

function layers(n: number, seed = 42, resM = 1) {
  return costLayers(makeSyntheticTerrain(n, seed), n, resM)
}

/** in-process stand-in for a Comlink worker (same API surface) */
function inProcessFactory(opts: { hang?: boolean } = {}): () => PlannerHandle {
  return () => {
    const svc = new PlannerService()
    return {
      api: {
        setLayers: (n: number, s: Float32Array, r: Float32Array) => svc.setLayers(n, s, r),
        plan: (req: unknown) => (opts.hang ? new Promise(() => {}) : Promise.resolve(svc.plan(req))),
      },
      terminate: () => {},
    } as unknown as PlannerHandle
  }
}

describe('PlannerService', () => {
  const n = 96
  const L = layers(n, 3)
  const svc = new PlannerService()
  svc.setLayers(n, L.slope, L.rough)

  function freePair() {
    const cost = combineCost(L, n, PROFILES['rover-rtg'], new Float32Array(n * n))
    const free: number[] = []
    for (let i = 0; i < n * n; i++) if (cost[i] !== Infinity) free.push(i)
    return [free[0]!, free[free.length - 1]!] as const
  }

  it('plans a path with length in metres', () => {
    const [start, goal] = freePair()
    const r = svc.plan({ profileId: 'rover-rtg', weights: W('rover-rtg'), start, goal, resM: 2 })
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.path[0]).toBe(start)
      expect(r.path.at(-1)).toBe(goal)
      expect(r.lengthM).toBeGreaterThan(0)
    }
  })

  it('explains a blocked goal with the slope and the limit', () => {
    const r = svc.plan({ profileId: 'astronaut', weights: W('astronaut'), start: 5 * n + 5, goal: 0 })
    expect(r).toMatchObject({ status: 'no-route', cause: 'goal-blocked' })
    if (r.status === 'no-route') expect(r.message).toMatch(/impassable/)
  })

  it('a stricter slope limit can disconnect the map and reports the required limit', () => {
    const [start, goal] = freePair()
    const r = svc.plan({ profileId: 'astronaut', weights: { ws: 4, wr: 10, maxSlope: 0.5 }, start, goal })
    expect(r.status).toBe('no-route')
    if (r.status === 'no-route') {
      expect(['start-blocked', 'goal-blocked', 'disconnected']).toContain(r.cause)
      expect(r.requiredSlopeDeg === null || r.requiredSlopeDeg > 0.5).toBe(true)
    }
  })

  it('rejects malformed requests (zod)', () => {
    expect(() => svc.plan({ profileId: 'tank', weights: W('astronaut'), start: 1, goal: 2 })).toThrow()
    expect(() => svc.plan({ profileId: 'astronaut', weights: { ws: NaN, wr: 1, maxSlope: 20 }, start: 1, goal: 2 })).toThrow()
    expect(() => svc.plan({ profileId: 'astronaut', weights: W('astronaut'), start: 1, goal: 2, extra: 1 })).toThrow()
  })
})

describe('PlannerPool', () => {
  it('plans all three profiles in parallel and returns one result each', async () => {
    const n = 96
    const L = layers(n, 3)
    const pool = new PlannerPool(inProcessFactory())
    await pool.setLayers(n, L.slope, L.rough, 2)
    const out = await pool.planAll({ start: 10 * n + 10, goal: 80 * n + 80 })
    expect(Object.keys(out).sort()).toEqual(['astronaut', 'rover-rtg', 'rover-solar'])
    for (const r of Object.values(out)) expect(['ok', 'no-route']).toContain(r.status)
    pool.dispose()
  })

  it('applies per-profile weight overrides', async () => {
    const n = 64
    const L = layers(n, 7)
    const pool = new PlannerPool(inProcessFactory(), 5000, ['rover-rtg'])
    await pool.setLayers(n, L.slope, L.rough, 2)
    const a = await pool.plan('rover-rtg', { start: 6 * n + 6, goal: 50 * n + 50 })
    const b = await pool.plan('rover-rtg', { start: 6 * n + 6, goal: 50 * n + 50, overrides: { 'rover-rtg': { ws: 40 } } })
    if (a.status === 'ok' && b.status === 'ok') expect(b.cost).toBeGreaterThan(a.cost)
    pool.dispose()
  })

  it('times out a hung worker and reports an error instead of wedging', async () => {
    const n = 32
    const L = layers(n, 1)
    const pool = new PlannerPool(inProcessFactory({ hang: true }), 50, ['astronaut'])
    await pool.setLayers(n, L.slope, L.rough, 2)
    const r = await pool.plan('astronaut', { start: 40, goal: 900 })
    expect(r).toMatchObject({ status: 'error' })
    pool.dispose()
  })
})

describe('1024x1024 latency (MARSX_BENCH=1, node/V8)', () => {
  it.runIf(process.env.MARSX_BENCH)('p95 of A* plans on a 1024x1024 grid is within budget', () => {
    const n = 1024
    const L = layers(n, 42, 2)
    const svc = new PlannerService()
    svc.setLayers(n, L.slope, L.rough)
    const w = W('rover-rtg')
    const cost = combineCost(L, n, w, new Float32Array(n * n))
    const pick = (x: number, y: number) => {
      for (let r = 0; r < n; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx >= 1 && yy >= 1 && xx < n - 1 && yy < n - 1 && cost[yy * n + xx]! < Infinity) return yy * n + xx
          }
      return 0
    }
    const pairs = [
      [pick(2, 2), pick(n - 3, n - 3)],
      [pick(2, n - 3), pick(n - 3, 2)],
      [pick(n >> 1, 2), pick(n >> 1, n - 3)],
      [pick(100, 100), pick(900, 300)],
      [pick(300, 800), pick(700, 200)],
    ] as const
    svc.plan({ profileId: 'rover-rtg', weights: W('rover-rtg'), start: pairs[0][0], goal: pairs[0][1] }) // JIT warm-up
    const times: number[] = []
    for (let rep = 0; rep < 4; rep++) {
      for (const [s, g] of pairs) {
        const t0 = performance.now()
        const r = svc.plan({ profileId: 'rover-rtg', weights: W('rover-rtg'), start: s, goal: g })
        times.push(performance.now() - t0)
        expect(['ok', 'no-route']).toContain(r.status)
      }
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!
    console.log(`A* 1024^2 over ${times.length} queries: median ${times[times.length >> 1]!.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, max ${times.at(-1)!.toFixed(0)} ms`)
    expect(p95).toBeLessThan(300) // target 200 ms on dev HW; 300 = CI regression guard
  })
})
