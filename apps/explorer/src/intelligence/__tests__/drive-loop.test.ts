import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { configFor } from '@/features/replay/verify'
import { ACTIONS } from '../contracts'
import { LiveTrack, runDrive } from '../drive/drive-loop'
import { PolicyClient, type PolicyWorkerHandle } from '../policy/policy-client'
import { PolicyService } from '../policy/policy-service'
import { EnvLite, type Terrain } from '../sim/env-lite'
import { gemmModel } from './onnx-builder'

const N = 24
const flat = (): Terrain => ({ rows: N, cols: N, resM: 2, slope: new Float32Array(N * N).fill(2), step: new Float32Array(N * N).fill(0.05), height: new Float32Array(N * N) })
const cfg = () => ({ ...configFor('jezero-v1/l1/rtg-geometry')!, maxSteps: 120 })

/** greedy toward the goal using the goal-direction features of obs/1 (indices 486, 487) */
const greedy = async (obs: Float32Array, exclude: ReadonlySet<number> = new Set()): Promise<number> => {
  const dr = obs[486]!
  const dc = obs[487]!
  let best = 8
  let score = -Infinity
  ACTIONS.forEach(([, r, c], i) => {
    if (i === 8 || exclude.has(i)) return
    const s = r * dr + c * dc
    if (s > score) {
      score = s
      best = i
    }
  })
  return best
}

describe('live drive loop', () => {
  it('a goal-seeking policy reaches the goal, deterministically', async () => {
    const run = async () => {
      const t = new LiveTrack(200)
      const r = await runDrive({ env: new EnvLite(flat(), cfg()), start: [2, 2], goals: [[18, 15]], infer: greedy, track: t })
      return { r, t }
    }
    const a = await run()
    const b = await run()
    expect(a.r.outcome).toBe('success')
    expect(a.r.steps).toBeGreaterThan(10)
    expect(a.t.count).toBe(a.r.steps + 1)
    expect(a.t.rows[a.t.count - 1]).toBe(18)
    expect(a.t.cols[a.t.count - 1]).toBe(15)
    expect(Array.from(a.t.rows.slice(0, a.t.count))).toEqual(Array.from(b.t.rows.slice(0, b.t.count)))
    expect(a.t.events.at(-1)).toMatchObject({ kind: 'end' })
  })

  it('a policy that keeps waiting is stuck (it never gets closer), not a silent timeout', async () => {
    const t = new LiveTrack(200)
    const r = await runDrive({ env: new EnvLite(flat(), cfg()), start: [2, 2], goals: [[18, 15]], infer: async () => 8, track: t })
    expect(r.outcome).toBe('stuck')
    expect(r.steps).toBeLessThanOrEqual(61)
  })

  it('walking into a wall is a blocked attempt with a marker, not a crash of the loop', async () => {
    const t = new LiveTrack(200)
    const r = await runDrive({ env: new EnvLite(flat(), cfg()), start: [0, 5], goals: [[18, 15]], infer: async () => 0, track: t })
    expect(r.blockedAttempts).toBeGreaterThan(0)
    expect(t.events.some((e) => e.kind === 'blocked')).toBe(true)
  })

  it('an inference failure ends the drive as an error', async () => {
    const t = new LiveTrack(50)
    const r = await runDrive({
      env: new EnvLite(flat(), cfg()),
      start: [2, 2],
      goals: [[18, 15]],
      infer: async () => {
        throw new Error('worker died')
      },
      track: t,
    })
    expect(r.outcome).toBe('error')
    expect(r.error).toBe('worker died')
    expect(t.done).toBe(true)
  })

  it('stops on abort', async () => {
    const ctl = new AbortController()
    const t = new LiveTrack(200)
    let n = 0
    const r = await runDrive({
      env: new EnvLite(flat(), cfg()),
      start: [2, 2],
      goals: [[18, 15]],
      infer: async (o) => {
        if (++n === 5) ctl.abort()
        return greedy(o)
      },
      track: t,
      signal: ctl.signal,
    })
    expect(r.outcome).toBe('aborted')
  })

  it('drives through the real policy worker service with the Gemm test model', async () => {
    const require = createRequire(import.meta.url)
    const wasm = readFileSync(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'))
    const svc = new PolicyService()
    const handle: PolicyWorkerHandle = { api: { init: (r) => svc.init(r), infer: (r) => svc.infer(r) }, terminate: () => void svc.dispose() }
    const client = new PolicyClient({ factory: () => handle, wasmLoader: async () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer })
    const m = gemmModel()
    await client.load(m.buffer.slice(m.byteOffset, m.byteOffset + m.byteLength) as ArrayBuffer)
    const t = new LiveTrack(200)
    const r = await runDrive({ env: new EnvLite(flat(), cfg()), start: [2, 10], goals: [[18, 15]], infer: async (o) => (await client.infer(o, 1)).actions[0]!, track: t })
    expect(['success', 'collision', 'battery', 'timeout', 'stuck']).toContain(r.outcome)
    expect(r.steps).toBeGreaterThan(0)
    client.terminate()
  }, 60_000)
})

describe('guided drive and stuck detection', () => {
  it('subGoals puts a waypoint every ~spacing cells and always ends on the real goal', async () => {
    const { subGoals } = await import('../drive/drive-loop')
    const path = Array.from({ length: 41 }, (_, i) => [i, 0] as const)
    const g = subGoals(path, 12)
    expect(g.at(-1)).toEqual([40, 0])
    expect(g.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < g.length - 1; i++) expect(g[i]![0] - g[i - 1]![0]).toBeGreaterThanOrEqual(12)
  })

  it('guided: the policy drives from sub-goal to sub-goal and reaches the goal', async () => {
    const t = new LiveTrack(400)
    const goals = [[10, 4], [4, 12], [18, 18]] as const
    const r = await runDrive({ env: new EnvLite(flat(), { ...cfg(), maxSteps: 300 }), start: [2, 2], goals, infer: greedy, track: t })
    expect(r.outcome).toBe('success')
    expect(r.reached).toBe(3)
    expect(r.total).toBe(3)
    // it really visits the intermediate sub-goals
    const cells = Array.from({ length: t.count }, (_, i) => `${t.rows[i]},${t.cols[i]}`)
    expect(cells).toContain('10,4')
    expect(cells).toContain('4,12')
  })

  it('a policy that stops making progress is declared stuck after about 60 steps, not after the whole step budget', async () => {
    const t = new LiveTrack(400)
    const r = await runDrive({ env: new EnvLite(flat(), { ...cfg(), maxSteps: 300 }), start: [2, 2], goals: [[18, 15]], infer: async () => 8, track: t })
    expect(r.outcome).toBe('stuck')
    expect(r.steps).toBeLessThan(80)
  })
})

describe('cells blocked in the simulation but planned by A*', () => {
  const blockedAt = (cells: [number, number][]): Terrain => {
    const t = flat()
    for (const [r, c] of cells) t.step[r * N + c] = 5 // far above the 0.525 m step limit
    return t
  }
  it('a start, a sub-goal and a goal on blocked cells are moved to the nearest free cell, so the drive still arrives', async () => {
    const { nearestFree } = await import('../drive/drive-loop')
    const terrain = blockedAt([[2, 2], [10, 4], [18, 15]])
    const env = new EnvLite(terrain, { ...cfg(), maxSteps: 300 })
    expect(nearestFree(env.cost, [10, 4])).not.toEqual([10, 4])
    const track = new LiveTrack(400)
    const r = await runDrive({ env, start: [2, 2], goals: [[10, 4], [18, 15]], infer: greedy, track })
    expect(r.outcome).toBe('success')
    expect(r.reached).toBe(2)
  })
  it('nearestFree returns the cell itself when free and null when nothing is free nearby', async () => {
    const { nearestFree } = await import('../drive/drive-loop')
    const cost = new Float32Array(100).fill(Infinity)
    expect(nearestFree(cost, [5, 5])).toBeNull()
    cost[5 * 10 + 5] = 1
    expect(nearestFree(cost, [5, 5])).toEqual([5, 5])
    expect(nearestFree(cost, [5, 7])).toEqual([5, 5])
  })
})
