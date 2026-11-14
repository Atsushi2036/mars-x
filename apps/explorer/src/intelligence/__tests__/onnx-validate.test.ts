import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_MODEL_BYTES, validateOnnx } from '../policy/onnx-validate'

import { cat, int64Tensor, ld, model, node, s, valueInfo, vi } from './onnx-builder'

describe('validateOnnx: accepted models', () => {
  it('parses a real SB3 export; the spike model (obs dim 249) fails only the shape contract', () => {
    const bytes = readFileSync(path.resolve(import.meta.dirname, 'fixtures/policy_logits.onnx'))
    const r = validateOnnx(new Uint8Array(bytes))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual(['input "obs" must have shape [batch, 505]', 'output "logits" must have shape [batch, 9]'])
  })
  it('accepts a minimal crafted model and marsx metadata', () => {
    const r = validateOnnx(model({ meta: [['marsx.contract', 'policy/1'], ['marsx.obs_spec', 'obs/1']] }))
    expect(r.ok).toBe(true)
  })
  it('accepts ai.onnx.ml domain', () => {
    expect(validateOnnx(model({ domain: 'ai.onnx.ml' })).ok).toBe(true)
  })
})

function errorsOf(bytes: Uint8Array) {
  const r = validateOnnx(bytes)
  expect(r.ok).toBe(false)
  return r.ok ? [] : r.errors.join(' | ')
}

describe('validateOnnx: rejections', () => {
  it('rejects empty, oversized and garbage input', () => {
    expect(validateOnnx(new Uint8Array(0)).ok).toBe(false)
    expect(errorsOf({ byteLength: MAX_MODEL_BYTES + 1 } as unknown as Uint8Array)).toMatch(/exceeds/)
    expect(validateOnnx(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])).ok).toBe(false)
    expect(validateOnnx(Uint8Array.from([0x3a, 0x7f, 1, 2])).ok).toBe(false) // length overruns buffer
  })
  it('rejects foreign domains in opset_import and nodes', () => {
    expect(errorsOf(model({ domain: 'com.microsoft' }))).toMatch(/not allowed/)
    expect(errorsOf(model({ nodes: [node('Gemm', ['obs', 'w'], ['logits'], [], 'custom.ops')] }))).toMatch(/domain "custom.ops"/)
  })
  it('rejects opsets outside 17..21', () => {
    expect(errorsOf(model({ opset: 13 }))).toMatch(/opset 13/)
    expect(errorsOf(model({ opset: 25 }))).toMatch(/opset 25/)
  })
  it('rejects external_data and data_location=EXTERNAL', () => {
    const ext = cat(vi(1, 9), vi(2, 1), s(8, 'w'), ld(13, cat(s(1, 'location'), s(2, 'weights.bin'))))
    expect(errorsOf(model({ inits: [ext] }))).toMatch(/external data/)
    const loc = cat(vi(1, 9), vi(2, 1), s(8, 'w'), vi(14, 1))
    expect(errorsOf(model({ inits: [loc] }))).toMatch(/external data/)
  })
  it('rejects Loop, Scan and If', () => {
    for (const op of ['Loop', 'Scan', 'If']) {
      expect(errorsOf(model({ nodes: [node(op, ['obs'], ['logits'])] }))).toMatch(new RegExp(op))
    }
  })
  it('rejects nodes carrying subgraph attributes', () => {
    const attr = ld(5, cat(s(1, 'body'), ld(6, [])))
    expect(errorsOf(model({ nodes: [node('Gemm', ['obs', 'w'], ['logits'], attr)] }))).toMatch(/subgraph/)
  })
  it('caps the node count', () => {
    const many = Array.from({ length: 2001 }, () => node('Relu', ['obs'], ['logits']))
    expect(errorsOf(model({ nodes: many }))).toMatch(/nodes/)
  })
  it('bounds Expand/Tile/ConstantOfShape by a static shape', () => {
    const small = model({ nodes: [node('Expand', ['obs', 'shp'], ['logits'])], inits: [int64Tensor('shp', [1, 9])] })
    expect(validateOnnx(small).ok).toBe(true)
    const huge = model({ nodes: [node('Tile', ['obs', 'rep'], ['logits'])], inits: [int64Tensor('rep', [100000, 100000])] })
    expect(errorsOf(huge)).toMatch(/unbounded|exceeds/)
    const dynamic = model({ nodes: [node('ConstantOfShape', ['obs'], ['logits'])] })
    expect(errorsOf(dynamic)).toMatch(/statically known/)
  })
  it('rejects model-local functions and training_info', () => {
    expect(errorsOf(model({ extraModel: ld(25, []) }))).toMatch(/functions/)
    expect(errorsOf(model({ extraModel: ld(20, []) }))).toMatch(/training_info/)
  })
  it('enforces the policy/1 I/O contract', () => {
    expect(errorsOf(model({ input: valueInfo('x', 1, [-1, 505]) }))).toMatch(/"obs"/)
    expect(errorsOf(model({ input: valueInfo('obs', 1, [-1, 100]) }))).toMatch(/505/)
    expect(errorsOf(model({ input: valueInfo('obs', 11, [-1, 505]) }))).toMatch(/float32/)
    expect(errorsOf(model({ output: valueInfo('logits', 1, [-1, 4]) }))).toMatch(/\[batch, 9\]/)
    expect(errorsOf(model({ output: valueInfo('whatever', 1, [-1, 9]) }))).toMatch(/output named/)
    expect(errorsOf(model({ meta: [['marsx.contract', 'policy/2']] }))).toMatch(/policy\/1/)
  })
  it('accepts an int64 action output', () => {
    expect(validateOnnx(model({ output: valueInfo('action', 7, [-1]) })).ok).toBe(true)
  })
})
