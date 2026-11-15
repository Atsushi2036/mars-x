/**
 * The "bring your own model" example (examples/my-first-model, trained with `python -m marsx.train.ppo`)
 * passes the web ONNX validator, matches its card and runs in onnxruntime-web (WASM, Node) with the same
 * actions as onnxruntime in Python (my-model.golden.json); its L1 run.json loads with the strict zod schema.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { N_ACTIONS, OBS_DIM, policyCardSchema, runSchema } from './contracts'
import { validateOnnx } from './policy/onnx-validate'
import { PolicyService } from './policy/policy-service'

const dir = path.resolve(import.meta.dirname, '../../../../examples/my-first-model')
const require = createRequire(import.meta.url)
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
const read = (f: string) => readFileSync(path.join(dir, f))

describe.skipIf(!existsSync(path.join(dir, 'my-model.onnx')))('example model (policy/1)', () => {
  const onnx = new Uint8Array(read('my-model.onnx'))
  const card = policyCardSchema.parse(JSON.parse(read('my-model.card.json').toString('utf8')))
  const golden = JSON.parse(read('my-model.golden.json').toString('utf8')) as {
    onnxSha256: string
    batch: number
    obs: number[]
    logits: number[]
    actions: number[]
  }

  it('passes the web validator and matches its card', async () => {
    expect(validateOnnx(onnx).ok).toBe(true)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', onnx))
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe(card.onnxSha256)
    expect(hex).toBe(golden.onnxSha256)
  })

  it('onnxruntime-web reproduces the Python actions', async () => {
    const wasm = new Uint8Array(readFileSync(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')))
    const svc = new PolicyService()
    await svc.init({ wasmBinary: ab(wasm), model: ab(onnx) })
    expect(golden.obs.length).toBe(golden.batch * OBS_DIM)
    const res = await svc.infer({ batch: golden.batch, obs: new Float32Array(golden.obs) })
    expect(Array.from(res.actions)).toEqual(golden.actions)
    expect(res.logits!.length).toBe(golden.batch * N_ACTIONS)
    golden.logits.forEach((v, i) => expect(res.logits![i]).toBeCloseTo(v, 4))
    await svc.dispose()
  }, 60_000)

  it('its L1 run.json loads with zod (53-bit seeds)', () => {
    const run = runSchema.parse(JSON.parse(read('my-model.L1.run.json').toString('utf8')))
    expect(run.suite.level).toBe('L1')
    expect(run.policy.sha256).toBe(card.onnxSha256)
    expect(run.episodes.every((e) => Number.isSafeInteger(e.seed))).toBe(true)
  })
})
