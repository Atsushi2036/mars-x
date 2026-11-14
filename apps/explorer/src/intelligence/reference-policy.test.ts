/**
 * The published reference policy (models/jezero-v1/policy.onnx, trained by `python -m marsx.train.ppo`)
 * passes the web ONNX validator (ADR-0007) and gives the same logits/actions in onnxruntime-web (WASM, Node)
 * as onnxruntime in Python (models/jezero-v1/golden.json).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { N_ACTIONS, OBS_DIM, policyCardSchema } from './contracts'
import { validateOnnx } from './policy/onnx-validate'
import { PolicyService } from './policy/policy-service'

const models = path.resolve(import.meta.dirname, '../../../../models/jezero-v1')
const require = createRequire(import.meta.url)
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
const onnxBytes = new Uint8Array(readFileSync(path.join(models, 'policy.onnx')))
const golden = JSON.parse(readFileSync(path.join(models, 'golden.json'), 'utf8')) as {
  onnxSha256: string
  batch: number
  obs: number[]
  logits: number[]
  actions: number[]
}
const card = policyCardSchema.parse(JSON.parse(readFileSync(path.join(models, 'policy-card.json'), 'utf8')))

describe('published reference policy (policy/1)', () => {
  it('passes the web ONNX validator and matches its card', async () => {
    const v = validateOnnx(onnxBytes)
    expect(v.ok).toBe(true)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', onnxBytes))
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe(card.onnxSha256)
    expect(hex).toBe(golden.onnxSha256)
    expect(card.onnxBytes).toBe(onnxBytes.byteLength)
  })

  it('onnxruntime-web reproduces the Python logits and actions', async () => {
    const wasm = new Uint8Array(readFileSync(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')))
    const svc = new PolicyService()
    await svc.init({ wasmBinary: ab(wasm), model: ab(onnxBytes) })
    expect(golden.obs.length).toBe(golden.batch * OBS_DIM)
    const res = await svc.infer({ batch: golden.batch, obs: new Float32Array(golden.obs) })
    expect(Array.from(res.actions)).toEqual(golden.actions)
    expect(res.logits!.length).toBe(golden.batch * N_ACTIONS)
    golden.logits.forEach((v, i) => expect(res.logits![i]).toBeCloseTo(v, 4))
    await svc.dispose()
  }, 60_000)
})
