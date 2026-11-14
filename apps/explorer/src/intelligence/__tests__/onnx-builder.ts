/** Tiny protobuf encoder to craft ONNX models in tests (hostile and valid). */
// ---- tiny protobuf encoder to craft hostile models -------------------------------------------
const enc = new TextEncoder()
export const varint = (n: number) => {
  const out: number[] = []
  while (n >= 128) {
    out.push((n % 128) | 128)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
export const cat = (...p: number[][]) => p.flat()
export const vi = (f: number, n: number) => cat(varint(f * 8), varint(n))
export const ld = (f: number, b: number[]) => cat(varint(f * 8 + 2), varint(b.length), b)
export const s = (f: number, v: string) => ld(f, Array.from(enc.encode(v)))

export const dim = (v: number) => ld(1, vi(1, v))
export const valueInfo = (name: string, elem: number, dims: number[]) =>
  cat(s(1, name), ld(2, ld(1, cat(vi(1, elem), ld(2, cat(...dims.map((d) => (d < 0 ? ld(1, s(2, 'N')) : dim(d)))))))))
export const node = (op: string, ins: string[], outs: string[], extra: number[] = [], domain = '') =>
  cat(...ins.map((i) => s(1, i)), ...outs.map((o) => s(2, o)), s(4, op), domain ? s(7, domain) : [], extra)
export const int64Tensor = (name: string, vals: number[]) =>
  cat(vi(1, vals.length), vi(2, 7), s(8, name), ld(7, cat(...vals.map((v) => varint(v)))))

export interface Opts {
  opset?: number
  domain?: string
  nodes?: number[][]
  inits?: number[][]
  input?: number[]
  output?: number[]
  meta?: [string, string][]
  extraModel?: number[]
}
export function model(o: Opts = {}): Uint8Array {
  const graph = cat(
    ...(o.nodes ?? [node('Gemm', ['obs', 'w'], ['logits'])]).map((n) => ld(1, n)),
    ...(o.inits ?? [cat(vi(1, 9), vi(2, 1), s(8, 'w'))]).map((t) => ld(5, t)),
    ld(11, o.input ?? valueInfo('obs', 1, [-1, 505])),
    ld(12, o.output ?? valueInfo('logits', 1, [-1, 9])),
  )
  return Uint8Array.from(
    cat(
      vi(1, 9),
      ld(8, cat(s(1, ''), vi(2, o.opset ?? 20))),
      o.domain ? ld(8, cat(s(1, o.domain), vi(2, 1))) : [],
      ...(o.meta ?? []).map(([k, v]) => ld(14, cat(s(1, k), s(2, v)))),
      ld(7, graph),
      o.extraModel ?? [],
    ),
  )
}


/** A valid obs[1..N,505] -> logits[N,9] Gemm model: logits = obs * W + 0, W[0, 3] = 1 (obs[0] drives action 3). */
export function gemmModel(): Uint8Array {
  const w = new Float32Array(505 * 9)
  w[0 * 9 + 3] = 1
  const wt = cat(vi(1, 505), vi(1, 9), vi(2, 1), s(8, 'w'), ld(9, Array.from(new Uint8Array(w.buffer))))
  const bias = cat(vi(1, 9), vi(2, 1), s(8, 'b'), ld(9, Array.from(new Uint8Array(9 * 4))))
  return model({ nodes: [node('Gemm', ['obs', 'w', 'b'], ['logits'])], inits: [wt, bias] })
}
