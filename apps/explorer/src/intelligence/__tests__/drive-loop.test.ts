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
const greedy = async (obs: Float32Array): Promise<number> => {
  const dr = obs[486]!
  const dc = obs[487]!
  let best = 8
  let score = -Infinity
  ACTIONS.forEach(([, r, c], i) => {
    if (i === 8) return
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
      const r = await runDrive({ env: new EnvLite(flat(), cfg()), start: [2, 2], goal: [18, 15], infer: greedy, track: t })
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

  it('a policy that keeps waiting times out at the step cap', async () => {
    const t = new LiveTrack(200)
    const r = await runDrive({ env: new EnvLite(flat(), cfg()), start: [2, 2], goal: [18, 15], infer: async () => 8, track: t })
    expect(r.outcome).toBe('timeout')
    expect(r.steps).toBe(120)
  })

  it('walking into a wall is a blocked attempt with a marker, not a crash of the loop', async () => {
    const t = new LiveTrack(200)
    const r = await runDrive({ env: new EnvLite(flat(), cfg()), start: [0, 5], goal: [18, 15], infer: async () => 0, track: t })
    expect(r.blockedAttempts).toBeGreaterThan(0)
    expect(t.events.some((e) => e.kind === 'blocked')).toBe(true)
  })

  it('an inference failure ends the drive as an error', async () => {
    const t = new LiveTrack(50)
    const r = await runDrive({
      env: new EnvLite(flat(), cfg()),
      start: [2, 2],
      goal: [18, 15],
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
      goal: [18, 15],
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
    const r = await runDrive({ env: new EnvLite(flat(), cfg()), start: [2, 10], goal: [18, 15], infer: async (o) => (await client.infer(o, 1)).actions[0]!, track: t })
    expect(['success', 'collision', 'battery', 'timeout']).toContain(r.outcome)
    expect(r.steps).toBeGreaterThan(0)
    client.terminate()
  }, 60_000)
})
