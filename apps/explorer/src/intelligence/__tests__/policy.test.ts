import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it, vi as vitestVi } from 'vitest'
import { OBS_DIM } from '../contracts'
import { PolicyClient, type PolicyWorkerHandle } from '../policy/policy-client'
import { PolicyService } from '../policy/policy-service'
import { gemmModel, model } from './onnx-builder'

const require = createRequire(import.meta.url)
const wasmPath = require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
const wasmBinary = () => ab(new Uint8Array(readFileSync(wasmPath)))

describe('PolicyService with the real onnxruntime-web (WASM, 1 thread)', () => {
  it('loads a contract-compliant model and returns argmax actions', async () => {
    const svc = new PolicyService()
    const info = await svc.init({ wasmBinary: wasmBinary(), model: ab(gemmModel()) })
    expect(info).toMatchObject({ opset: 20, outputName: 'logits' })
    const obs = new Float32Array(2 * OBS_DIM)
    obs[0] = 1 // sample 0 drives action 3 (W)
    // sample 1: all zeros -> all logits 0 -> argmax picks index 0
    const res = await svc.infer({ batch: 2, obs })
    expect(Array.from(res.actions)).toEqual([3, 0])
    expect(res.logits![3]).toBeCloseTo(1, 6)
    await svc.dispose()
  }, 30_000)

  it('refuses a hostile model before any session is created', async () => {
    const create = vitestVi.fn()
    const svc = new PolicyService(async () => ({ env: { wasm: { numThreads: 0, proxy: true } }, InferenceSession: { create }, Tensor: class {} }) as never)
    await expect(svc.init({ wasmBinary: wasmBinary(), model: ab(model({ domain: 'com.microsoft' })) })).rejects.toThrow(/rejected/)
    expect(create).not.toHaveBeenCalled()
  })

  it('forces numThreads=1, no proxy and WASM-only', async () => {
    const env = { wasm: { numThreads: 8, proxy: true } as { numThreads: number; proxy: boolean; wasmBinary?: unknown } }
    let eps: string[] = []
    const svc = new PolicyService(
      async () =>
        ({
          env,
          InferenceSession: {
            create: async (_m: Uint8Array, o: { executionProviders: string[] }) => {
              eps = o.executionProviders
              return { inputNames: ['obs'], outputNames: ['logits'], run: async () => ({}) }
            },
          },
          Tensor: class {},
        }) as never,
    )
    const bin = wasmBinary()
    await svc.init({ wasmBinary: bin, model: ab(gemmModel()) })
    expect(env.wasm.numThreads).toBe(1)
    expect(env.wasm.proxy).toBe(false)
    expect(env.wasm.wasmBinary).toBeInstanceOf(ArrayBuffer)
    expect(eps).toEqual(['wasm'])
  })

  it('rejects malformed messages (zod)', async () => {
    const svc = new PolicyService()
    await expect(svc.init({ wasmBinary: 'nope', model: 1 })).rejects.toThrow()
    await expect(svc.init({ wasmBinary: wasmBinary(), model: ab(gemmModel()), extra: true })).rejects.toThrow()
    await svc.init({ wasmBinary: wasmBinary(), model: ab(gemmModel()) })
    await expect(svc.infer({ batch: 1, obs: new Float32Array(10) })).rejects.toThrow(/obs length/)
    const bad = new Float32Array(OBS_DIM)
    bad[5] = Number.NaN
    await expect(svc.infer({ batch: 1, obs: bad })).rejects.toThrow(/non-finite/)
    await expect(svc.infer({ batch: 99999, obs: new Float32Array(OBS_DIM) })).rejects.toThrow()
    await svc.dispose()
  }, 30_000)
})

function fakeHandle(over: Partial<PolicyWorkerHandle['api']> = {}) {
  const terminate = vitestVi.fn()
  const handle: PolicyWorkerHandle = {
    api: {
      init: async () => ({ opset: 20, nodeCount: 1, ops: ['Gemm'], outputName: 'logits' as const }),
      infer: async ({ batch }: { batch: number }) => ({ actions: new Int32Array(batch), logits: new Float32Array(batch * 9), ms: 1 }),
      ...over,
    } as PolicyWorkerHandle['api'],
    terminate,
  }
  return { handle, terminate }
}

describe('PolicyClient', () => {
  const wasmLoader = async () => new ArrayBuffer(8)

  it('rejects oversized files by size BEFORE reading them', async () => {
    const reads = vitestVi.fn()
    const big = { size: 21 * 1024 * 1024, arrayBuffer: reads } as unknown as Blob
    const c = new PolicyClient({ wasmLoader, factory: () => fakeHandle().handle })
    await expect(c.load(big)).rejects.toThrow(/20 MB/)
    expect(reads).not.toHaveBeenCalled()
  })

  it('returns sha256 + info and keeps the worker alive on success', async () => {
    const f = fakeHandle()
    const c = new PolicyClient({ wasmLoader, factory: () => f.handle })
    const out = await c.load(ab(gemmModel()))
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(out.info.outputName).toBe('logits')
    expect(c.ready).toBe(true)
    const r = await c.infer(new Float32Array(OBS_DIM * 3), 3)
    expect(r.actions.length).toBe(3)
    expect(f.terminate).not.toHaveBeenCalled()
  })

  it('terminates the worker when init fails', async () => {
    const f = fakeHandle({ init: async () => { throw new Error('Model rejected: nope') } })
    const c = new PolicyClient({ wasmLoader, factory: () => f.handle })
    await expect(c.load(ab(gemmModel()))).rejects.toThrow(/rejected/)
    expect(f.terminate).toHaveBeenCalledTimes(1)
    expect(c.ready).toBe(false)
  })

  it('terminates the worker on timeout', async () => {
    const f = fakeHandle({ infer: () => new Promise(() => {}) as never })
    const c = new PolicyClient({ wasmLoader, factory: () => f.handle, inferTimeoutMs: 30 })
    await c.load(ab(gemmModel()))
    await expect(c.infer(new Float32Array(OBS_DIM), 1)).rejects.toThrow(/Timed out/)
    expect(f.terminate).toHaveBeenCalledTimes(1)
    await expect(c.infer(new Float32Array(OBS_DIM), 1)).rejects.toThrow(/No policy/)
  })

  it('terminates and rejects when the worker answers with an invalid shape', async () => {
    const f = fakeHandle({ infer: async () => ({ actions: new Int32Array([42]), logits: null, ms: 1 }) as never })
    const c = new PolicyClient({ wasmLoader, factory: () => f.handle })
    await c.load(ab(gemmModel()))
    await expect(c.infer(new Float32Array(OBS_DIM), 1)).rejects.toThrow(/outside act/)
    expect(f.terminate).toHaveBeenCalled()
  })

  it('terminates when the worker returns an unknown response shape (zod strict)', async () => {
    const f = fakeHandle({ infer: async () => ({ actions: new Int32Array(1), logits: null, ms: 1, leak: 'x' }) as never })
    const c = new PolicyClient({ wasmLoader, factory: () => f.handle })
    await c.load(ab(gemmModel()))
    await expect(c.infer(new Float32Array(OBS_DIM), 1)).rejects.toThrow()
    expect(f.terminate).toHaveBeenCalled()
  })

  it('wasm path exists on disk', () => expect(path.basename(wasmPath)).toBe('ort-wasm-simd-threaded.wasm'))
})
