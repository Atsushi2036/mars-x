/**
 * Static validation of an untrusted ONNX model BEFORE an inference session is created (security
 * review, "bring your own model" controls). A minimal protobuf wire reader walks ModelProto; no
 * model code is ever executed here.
 *
 * Rules (contract policy/1, design-intelligence 4.2):
 *  - size <= 20 MB; node count <= MAX_NODES
 *  - opset_import domains only ai.onnx (17..21) and ai.onnx.ml (<= 4); node domains likewise
 *  - no external_data / data_location=EXTERNAL initializers, no sparse initializers, no local functions
 *  - no Loop / Scan / If (or any node attribute holding a subgraph)
 *  - Expand / Tile / ConstantOfShape / Range / Pad / Resize only with statically known, bounded arguments
 *  - tensor attributes (t, tensors) never use external data (e.g. Constant); sparse tensor attributes refused
 *  - graph I/O: single float32 input `obs` [batch, 505]; output `logits` float32 [batch, 9]
 *    (or `action` int64 [batch])
 *  - metadata marsx.contract / marsx.obs_spec, when present, must be policy/1 and obs/1
 */
import { OBS_DIM, N_ACTIONS, OBS_SPEC, POLICY_CONTRACT } from '../contracts'

export const MAX_MODEL_BYTES = 20 * 1024 * 1024
export const MAX_NODES = 2000
export const MAX_STATIC_ELEMENTS = 1 << 20
export const MAX_RESIZE_SCALE = 64
const MAX_TENSOR_ELEMENTS = 1 << 24
const MIN_OPSET = 17
const MAX_OPSET = 21
const MAX_ML_OPSET = 4
const BANNED_OPS = new Set(['Loop', 'Scan', 'If', 'SequenceMap'])
const BOUNDED_OPS = new Set(['Expand', 'Tile', 'ConstantOfShape'])
const DT_FLOAT = 1
const DT_INT64 = 7

export interface OnnxSummary {
  opset: number
  nodeCount: number
  ops: string[]
  inputName: 'obs'
  outputName: 'logits' | 'action'
  metadata: Record<string, string>
}
export type OnnxValidation = { ok: true; summary: OnnxSummary } | { ok: false; errors: string[] }

class Fail extends Error {}

class Reader {
  pos: number
  constructor(
    readonly buf: Uint8Array,
    pos = 0,
    readonly end = buf.length,
  ) {
    this.pos = pos
  }
  get eof() {
    return this.pos >= this.end
  }
  varint(): number {
    let result = 0
    let mul = 1
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new Fail('truncated protobuf')
      const b = this.buf[this.pos++]!
      result += (b & 0x7f) * mul
      if (!(b & 0x80)) return result
      mul *= 128
    }
    throw new Fail('malformed varint')
  }
  tag(): [field: number, wire: number] {
    const t = this.varint()
    return [Math.floor(t / 8), t % 8]
  }
  bytes(): Uint8Array {
    const len = this.varint()
    if (len > this.end - this.pos) throw new Fail('length-delimited field overruns buffer')
    const out = this.buf.subarray(this.pos, this.pos + len)
    this.pos += len
    return out
  }
  skip(wire: number) {
    if (wire === 0) this.varint()
    else if (wire === 1) this.advance(8)
    else if (wire === 2) this.bytes()
    else if (wire === 5) this.advance(4)
    else throw new Fail(`unsupported wire type ${wire}`)
  }
  private advance(n: number) {
    if (n > this.end - this.pos) throw new Fail('truncated protobuf')
    this.pos += n
  }
}

const dec = new TextDecoder('utf-8', { fatal: false })
const str = (b: Uint8Array) => dec.decode(b)
const sub = (b: Uint8Array) => new Reader(b)

interface Tensor {
  name: string
  dtype: number
  dims: number[]
  external: boolean
  /** decoded values (int64 tensors only, bounded) */
  ints: number[] | null
  /** decoded values (small float32 tensors only, e.g. Resize scales) */
  floats: number[] | null
}

function parseTensor(b: Uint8Array): Tensor {
  const r = sub(b)
  const t: Tensor = { name: '', dtype: 0, dims: [], external: false, ints: null, floats: null }
  const f32: number[] = []
  let raw: Uint8Array | null = null
  const i64: number[] = []
  while (!r.eof) {
    const [f, w] = r.tag()
    if (f === 1) {
      if (w === 2) {
        const p = sub(r.bytes())
        while (!p.eof) t.dims.push(p.varint())
      } else t.dims.push(r.varint())
    } else if (f === 2 && w === 0) t.dtype = r.varint()
    else if (f === 7 && w === 2) {
      const p = sub(r.bytes())
      while (!p.eof && i64.length <= MAX_TENSOR_ELEMENTS) i64.push(p.varint())
    } else if (f === 4 && w === 2) {
      const p = r.bytes()
      if (p.length % 4 === 0 && p.length <= 4 * 64) {
        const dv = new DataView(p.buffer, p.byteOffset, p.byteLength)
        for (let i = 0; i < p.length / 4; i++) f32.push(dv.getFloat32(4 * i, true))
      }
    } else if (f === 8 && w === 2) t.name = str(r.bytes())
    else if (f === 9 && w === 2) raw = r.bytes()
    else if (f === 13 && w === 2) {
      r.bytes()
      t.external = true
    } else if (f === 14 && w === 0) {
      if (r.varint() === 1) t.external = true
    } else r.skip(w)
  }
  if (t.dtype === DT_INT64) {
    if (raw && raw.length % 8 === 0 && raw.length <= 8 * 64) {
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      t.ints = Array.from({ length: raw.length / 8 }, (_, i) => Number(dv.getBigInt64(8 * i, true)))
    } else if (!raw && i64.length) t.ints = i64
  } else if (t.dtype === DT_FLOAT) {
    if (raw && raw.length % 4 === 0 && raw.length <= 4 * 64) {
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      t.floats = Array.from({ length: raw.length / 4 }, (_, i) => dv.getFloat32(4 * i, true))
    } else if (!raw && f32.length) t.floats = f32
  }
  return t
}

interface Node {
  op: string
  domain: string
  inputs: string[]
  outputs: string[]
  hasSubgraph: boolean
  hasSparseAttr: boolean
  externalAttr: boolean
  constant: Tensor | null
}

function parseNode(b: Uint8Array): Node {
  const r = sub(b)
  const n: Node = { op: '', domain: '', inputs: [], outputs: [], hasSubgraph: false, hasSparseAttr: false, externalAttr: false, constant: null }
  while (!r.eof) {
    const [f, w] = r.tag()
    if (f === 1 && w === 2) n.inputs.push(str(r.bytes()))
    else if (f === 2 && w === 2) n.outputs.push(str(r.bytes()))
    else if (f === 4 && w === 2) n.op = str(r.bytes())
    else if (f === 7 && w === 2) n.domain = str(r.bytes())
    else if (f === 5 && w === 2) {
      const a = sub(r.bytes())
      let name = ''
      let tensor: Uint8Array | null = null
      while (!a.eof) {
        const [af, aw] = a.tag()
        if (af === 1 && aw === 2) name = str(a.bytes())
        else if (af === 5 && aw === 2) {
          tensor = a.bytes()
          if (parseTensor(tensor).external) n.externalAttr = true
        } else if (af === 10 && aw === 2) {
          if (parseTensor(a.bytes()).external) n.externalAttr = true // repeated `tensors`
        } else if ((af === 6 || af === 11) && aw === 2) {
          a.bytes()
          n.hasSubgraph = true
        } else if ((af === 22 || af === 23) && aw === 2) {
          a.bytes()
          n.hasSparseAttr = true // sparse_tensor / sparse_tensors attributes: refuse
        } else a.skip(aw)
      }
      if (name === 'value' && tensor) n.constant = parseTensor(tensor)
    } else r.skip(w)
  }
  return n
}

interface Dim {
  value: number | null
}
interface ValueInfo {
  name: string
  elemType: number
  dims: Dim[]
}

function parseValueInfo(b: Uint8Array): ValueInfo {
  const r = sub(b)
  const v: ValueInfo = { name: '', elemType: 0, dims: [] }
  while (!r.eof) {
    const [f, w] = r.tag()
    if (f === 1 && w === 2) v.name = str(r.bytes())
    else if (f === 2 && w === 2) {
      const ty = sub(r.bytes())
      while (!ty.eof) {
        const [tf, tw] = ty.tag()
        if (tf === 1 && tw === 2) {
          const tt = sub(ty.bytes())
          while (!tt.eof) {
            const [ff, fw] = tt.tag()
            if (ff === 1 && fw === 0) v.elemType = tt.varint()
            else if (ff === 2 && fw === 2) {
              const sh = sub(tt.bytes())
              while (!sh.eof) {
                const [sf, sw] = sh.tag()
                if (sf === 1 && sw === 2) {
                  const d = sub(sh.bytes())
                  let value: number | null = null
                  while (!d.eof) {
                    const [df, dw] = d.tag()
                    if (df === 1 && dw === 0) value = d.varint()
                    else d.skip(dw)
                  }
                  v.dims.push({ value })
                } else sh.skip(sw)
              }
            } else tt.skip(fw)
          }
        } else ty.skip(tw)
      }
    } else r.skip(w)
  }
  return v
}

const product = (xs: number[]) => xs.reduce((a, b) => a * b, 1)

export function validateOnnx(bytes: Uint8Array): OnnxValidation {
  const errors: string[] = []
  const bad = (m: string) => {
    if (errors.length < 20) errors.push(m)
  }
  if (bytes.byteLength === 0) return { ok: false, errors: ['empty file'] }
  if (bytes.byteLength > MAX_MODEL_BYTES) return { ok: false, errors: [`model exceeds ${MAX_MODEL_BYTES / 1048576} MB`] }
  try {
    const r = sub(bytes)
    let graph: Uint8Array | null = null
    const opsets: { domain: string; version: number }[] = []
    const metadata: Record<string, string> = {}
    while (!r.eof) {
      const [f, w] = r.tag()
      if (f === 7 && w === 2) {
        if (graph) throw new Fail('multiple graphs')
        graph = r.bytes()
      } else if (f === 8 && w === 2) {
        const o = sub(r.bytes())
        let domain = ''
        let version = 0
        while (!o.eof) {
          const [of, ow] = o.tag()
          if (of === 1 && ow === 2) domain = str(o.bytes())
          else if (of === 2 && ow === 0) version = o.varint()
          else o.skip(ow)
        }
        opsets.push({ domain, version })
      } else if (f === 14 && w === 2) {
        const e = sub(r.bytes())
        let k = ''
        let v = ''
        while (!e.eof) {
          const [ef, ew] = e.tag()
          if (ef === 1 && ew === 2) k = str(e.bytes())
          else if (ef === 2 && ew === 2) v = str(e.bytes())
          else e.skip(ew)
        }
        if (k.length <= 128 && v.length <= 1024 && Object.keys(metadata).length < 64) metadata[k] = v
      } else if (f === 25 && w === 2) {
        r.bytes()
        bad('model-local functions are not allowed')
      } else if (f === 20 && w === 2) {
        r.bytes()
        bad('training_info is not allowed')
      } else r.skip(w)
    }
    if (!graph) throw new Fail('no graph in model')

    let opset = 0
    if (opsets.length === 0) bad('missing opset_import')
    for (const o of opsets) {
      if (o.domain === '' || o.domain === 'ai.onnx') {
        if (o.version < MIN_OPSET || o.version > MAX_OPSET) bad(`ai.onnx opset ${o.version} outside ${MIN_OPSET}..${MAX_OPSET}`)
        opset = o.version
      } else if (o.domain === 'ai.onnx.ml') {
        if (o.version > MAX_ML_OPSET) bad(`ai.onnx.ml opset ${o.version} > ${MAX_ML_OPSET}`)
      } else bad(`domain "${o.domain.slice(0, 64)}" is not allowed (only ai.onnx and ai.onnx.ml)`)
    }
    if (metadata['marsx.contract'] !== undefined && metadata['marsx.contract'] !== POLICY_CONTRACT) {
      bad(`marsx.contract must be ${POLICY_CONTRACT}`)
    }
    if (metadata['marsx.obs_spec'] !== undefined && metadata['marsx.obs_spec'] !== OBS_SPEC) bad(`marsx.obs_spec must be ${OBS_SPEC}`)

    // graph
    const g = sub(graph)
    const nodes: Node[] = []
    const inits = new Map<string, Tensor>()
    const inputs: ValueInfo[] = []
    const outputs: ValueInfo[] = []
    while (!g.eof) {
      const [f, w] = g.tag()
      if (f === 1 && w === 2) {
        if (nodes.length >= MAX_NODES) throw new Fail(`more than ${MAX_NODES} nodes`)
        nodes.push(parseNode(g.bytes()))
      } else if (f === 5 && w === 2) {
        const t = parseTensor(g.bytes())
        if (inits.size > 10_000) throw new Fail('too many initializers')
        inits.set(t.name, t)
        if (t.external) bad(`initializer "${t.name.slice(0, 64)}" uses external data`)
        if (product(t.dims) > MAX_TENSOR_ELEMENTS) bad(`initializer "${t.name.slice(0, 64)}" is too large`)
      } else if (f === 15 && w === 2) {
        g.bytes()
        bad('sparse initializers are not allowed')
      } else if (f === 11 && w === 2) inputs.push(parseValueInfo(g.bytes()))
      else if (f === 12 && w === 2) outputs.push(parseValueInfo(g.bytes()))
      else g.skip(w)
    }

    const known = new Map<string, number[]>() // statically known int64 vectors
    const knownF = new Map<string, number[]>() // statically known small float32 vectors
    for (const [name, t] of inits) {
      if (t.ints) known.set(name, t.ints)
      if (t.floats) knownF.set(name, t.floats)
    }
    for (const n of nodes) {
      if (n.op !== 'Constant' || !n.outputs[0]) continue
      if (n.constant?.ints) known.set(n.outputs[0], n.constant.ints)
      if (n.constant?.floats) knownF.set(n.outputs[0], n.constant.floats)
    }
    const scalar = (name: string | undefined) => {
      const v = name ? (known.get(name) ?? knownF.get(name)) : undefined
      return v && v.length === 1 ? v[0]! : undefined
    }

    const ops = new Set<string>()
    for (const n of nodes) {
      ops.add(n.op)
      if (n.domain !== '' && n.domain !== 'ai.onnx' && n.domain !== 'ai.onnx.ml') bad(`node "${n.op}" uses domain "${n.domain.slice(0, 64)}"`)
      if (BANNED_OPS.has(n.op)) bad(`operator ${n.op} is not allowed`)
      if (n.hasSubgraph) bad(`operator ${n.op} carries a subgraph`)
      if (n.hasSparseAttr) bad(`operator ${n.op} carries a sparse tensor attribute`)
      if (n.externalAttr) bad(`operator ${n.op} has a tensor attribute with external data`)
      if (n.op === 'Range') {
        const [a, l, d] = [scalar(n.inputs[0]), scalar(n.inputs[1]), scalar(n.inputs[2])]
        if (a === undefined || l === undefined || d === undefined) bad('Range needs static start, limit and delta')
        else if (d === 0 || !Number.isFinite((l - a) / d) || (l - a) / d > MAX_STATIC_ELEMENTS) bad('Range output is unbounded')
      }
      if (n.op === 'Pad') {
        const pads = n.inputs[1] ? known.get(n.inputs[1]) : undefined
        if (!pads) bad('Pad needs static pads')
        else if (pads.reduce((acc, v) => acc + Math.abs(v), 0) > MAX_STATIC_ELEMENTS) bad('Pad amounts exceed the bound')
      }
      if (n.op === 'Resize') {
        const sizes = n.inputs[3] ? known.get(n.inputs[3]) : undefined
        const scales = n.inputs[2] ? knownF.get(n.inputs[2]) : undefined
        if (sizes) {
          if (sizes.some((v) => v < 0) || product(sizes) > MAX_STATIC_ELEMENTS) bad('Resize sizes exceed the bound')
        } else if (scales) {
          if (scales.some((v) => !Number.isFinite(v) || v < 0 || v > MAX_RESIZE_SCALE)) bad('Resize scales exceed the bound')
        } else bad('Resize needs static sizes or scales')
      }
      if (BOUNDED_OPS.has(n.op)) {
        const shapeInput = n.op === 'ConstantOfShape' ? n.inputs[0] : n.inputs[1]
        const vals = shapeInput ? known.get(shapeInput) : undefined
        if (!vals) bad(`${n.op} needs a statically known shape input`)
        else if (vals.some((v) => !Number.isFinite(v) || v < 0) || product(vals) > MAX_STATIC_ELEMENTS) {
          bad(`${n.op} shape is unbounded or exceeds ${MAX_STATIC_ELEMENTS} elements`)
        }
      }
    }

    // I/O contract: real inputs exclude initializers (old IR versions list them as inputs too)
    const realInputs = inputs.filter((i) => !inits.has(i.name))
    const inp = realInputs[0]
    if (realInputs.length !== 1 || inp?.name !== 'obs') bad('the model must have exactly one input named "obs"')
    else {
      if (inp.elemType !== DT_FLOAT) bad('input "obs" must be float32')
      if (inp.dims.length !== 2 || inp.dims[1]?.value !== OBS_DIM) bad(`input "obs" must have shape [batch, ${OBS_DIM}]`)
    }
    const out = outputs.find((o) => o.name === 'logits') ?? outputs.find((o) => o.name === 'action')
    if (!out) bad('the model must expose an output named "logits" (float32 [batch, 9]) or "action" (int64 [batch])')
    else if (out.name === 'logits') {
      if (out.elemType !== DT_FLOAT) bad('output "logits" must be float32')
      if (out.dims.length !== 2 || out.dims[1]?.value !== N_ACTIONS) bad(`output "logits" must have shape [batch, ${N_ACTIONS}]`)
    } else if (out.elemType !== DT_INT64) bad('output "action" must be int64')

    if (errors.length) return { ok: false, errors }
    return {
      ok: true,
      summary: {
        opset,
        nodeCount: nodes.length,
        ops: [...ops].sort(),
        inputName: 'obs',
        outputName: out!.name as 'logits' | 'action',
        metadata,
      },
    }
  } catch (e) {
    if (e instanceof Fail) return { ok: false, errors: [...errors, e.message] }
    throw e
  }
}
