/**
 * Attack models for the web ONNX validator (security review findings): tensor-list and sparse attributes,
 * Constant with external data, and unbounded Range / Pad / Resize.
 */
import { describe, expect, it } from 'vitest'
import { validateOnnx } from './policy/onnx-validate'
import { cat, int64Tensor, ld, model, node, s, vi } from './__tests__/onnx-builder'

const externalTensor = (name: string) => cat(vi(1, 2), vi(2, 1), s(8, name), ld(13, cat(s(1, 'location'), s(2, 'x.bin'))))
const attr = (name: string, field: number, payload: number[]) => ld(5, cat(s(1, name), ld(field, payload)))
const floatTensor = (name: string, vals: number[]) =>
  cat(vi(1, vals.length), vi(2, 1), s(8, name), ld(9, Array.from(new Uint8Array(new Float32Array(vals).buffer))))
const gemm = node('Gemm', ['obs', 'w'], ['logits'])
const w = cat(vi(1, 9), vi(2, 1), s(8, 'w'))
const errorsOf = (bytes: Uint8Array) => {
  const r = validateOnnx(bytes)
  return r.ok ? [] : r.errors
}

describe('validateOnnx: attack models', () => {
  it('rejects a Constant whose value tensor uses external data', () => {
    const c = node('Constant', [], ['c'], attr('value', 5, externalTensor('c')))
    expect(errorsOf(model({ nodes: [c, gemm], inits: [w] })).join(' ')).toMatch(/external data/)
  })

  it('rejects external data hidden in a repeated `tensors` attribute (field 10)', () => {
    const n = node('Identity', ['obs'], ['x'], attr('payload', 10, externalTensor('t')))
    expect(errorsOf(model({ nodes: [n, gemm], inits: [w] })).join(' ')).toMatch(/external data/)
  })

  it('rejects sparse_tensor (22) and sparse_tensors (23) attributes', () => {
    for (const f of [22, 23]) {
      const n = node('Identity', ['obs'], ['x'], attr('sp', f, cat(ld(1, cat(vi(1, 1), vi(2, 1))))))
      expect(errorsOf(model({ nodes: [n, gemm], inits: [w] })).join(' ')).toMatch(/sparse tensor attribute/)
    }
  })

  it('bounds Range: dynamic or huge outputs are rejected, small static ones pass', () => {
    const dyn = node('Range', ['obs', 'obs', 'obs'], ['r'])
    expect(errorsOf(model({ nodes: [dyn, gemm], inits: [w] })).join(' ')).toMatch(/Range needs static/)
    const huge = node('Range', ['a', 'l', 'd'], ['r'])
    const hugeInits = [int64Tensor('a', [0]), int64Tensor('l', [2 ** 40]), int64Tensor('d', [1]), w]
    expect(errorsOf(model({ nodes: [huge, gemm], inits: hugeInits })).join(' ')).toMatch(/Range output is unbounded/)
    const small = [int64Tensor('a', [0]), int64Tensor('l', [16]), int64Tensor('d', [1]), w]
    expect(validateOnnx(model({ nodes: [huge, gemm], inits: small })).ok).toBe(true)
  })

  it('bounds Pad amounts', () => {
    const pad = node('Pad', ['obs', 'p'], ['y'])
    expect(errorsOf(model({ nodes: [pad, gemm], inits: [int64Tensor('p', [0, 2 ** 30, 0, 0]), w] })).join(' ')).toMatch(/Pad amounts/)
    expect(errorsOf(model({ nodes: [node('Pad', ['obs', 'obs'], ['y']), gemm], inits: [w] })).join(' ')).toMatch(/Pad needs static/)
    expect(validateOnnx(model({ nodes: [pad, gemm], inits: [int64Tensor('p', [0, 1, 0, 1]), w] })).ok).toBe(true)
  })

  it('bounds Resize sizes and scales', () => {
    const bySizes = node('Resize', ['obs', '', '', 'sz'], ['y'])
    expect(errorsOf(model({ nodes: [bySizes, gemm], inits: [int64Tensor('sz', [1, 1, 2 ** 15, 2 ** 15]), w] })).join(' ')).toMatch(
      /Resize sizes/,
    )
    const byScales = node('Resize', ['obs', '', 'sc'], ['y'])
    expect(errorsOf(model({ nodes: [byScales, gemm], inits: [floatTensor('sc', [1, 1, 1000, 1000]), w] })).join(' ')).toMatch(
      /Resize scales/,
    )
    expect(validateOnnx(model({ nodes: [byScales, gemm], inits: [floatTensor('sc', [1, 1, 2, 2]), w] })).ok).toBe(true)
    expect(errorsOf(model({ nodes: [node('Resize', ['obs'], ['y']), gemm], inits: [w] })).join(' ')).toMatch(/Resize needs static/)
  })
})
