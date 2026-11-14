import { N_ACTIONS, OBS_DIM } from '../contracts'
import { inferRequestSchema, initRequestSchema, type InferResponse, type InitResponse } from './messages'
import { validateOnnx } from './onnx-validate'

/**
 * Worker-side ONNX policy runner. WASM backend only, single thread, no proxy worker, wasmBinary
 * supplied by the page. The model is statically validated BEFORE the session exists.
 * `loadOrt` is injectable so the logic is testable without a browser.
 */

/** Minimal subset of onnxruntime-web used here. */
export interface OrtLike {
  env: { wasm: { numThreads: number; proxy: boolean; wasmBinary?: ArrayBuffer | Uint8Array; simd?: boolean } }
  InferenceSession: {
    create(model: Uint8Array, opts: { executionProviders: string[]; graphOptimizationLevel?: string }): Promise<SessionLike>
  }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
}
export interface SessionLike {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | BigInt64Array | Int32Array }>>
  release?(): Promise<void>
}

export const defaultOrtLoader = async (): Promise<OrtLike> => (await import('onnxruntime-web/wasm')) as unknown as OrtLike

export class PolicyService {
  private session: SessionLike | null = null
  private outputName: 'logits' | 'action' = 'logits'

  constructor(private loadOrt: () => Promise<OrtLike> = defaultOrtLoader) {}

  async init(request: unknown): Promise<InitResponse> {
    const req = initRequestSchema.parse(request)
    const bytes = new Uint8Array(req.model)
    const v = validateOnnx(bytes)
    if (!v.ok) throw new Error(`Model rejected: ${v.errors.join('; ')}`)
    const ort = await this.loadOrt()
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    ort.env.wasm.wasmBinary = req.wasmBinary
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    if (session.inputNames.length !== 1 || session.inputNames[0] !== 'obs') throw new Error('Session input is not "obs"')
    if (!session.outputNames.includes(v.summary.outputName)) throw new Error('Session output does not match the contract')
    this.session = session
    this.outputName = v.summary.outputName
    this.ort = ort
    return { opset: v.summary.opset, nodeCount: v.summary.nodeCount, ops: v.summary.ops.slice(0, 256), outputName: v.summary.outputName }
  }
  private ort: OrtLike | null = null

  async infer(request: unknown): Promise<InferResponse> {
    const req = inferRequestSchema.parse(request)
    if (!this.session || !this.ort) throw new Error('Policy not initialised')
    const t0 = performance.now()
    const out = await this.session.run({ obs: new this.ort.Tensor('float32', req.obs, [req.batch, OBS_DIM]) })
    const t = out[this.outputName]
    if (!t) throw new Error('Missing model output')
    const actions = new Int32Array(req.batch)
    if (this.outputName === 'logits') {
      const logits = Float32Array.from(t.data as Float32Array)
      if (logits.length !== req.batch * N_ACTIONS) throw new Error('Unexpected logits size')
      for (let b = 0; b < req.batch; b++) {
        let best = 0
        for (let k = 1; k < N_ACTIONS; k++) if (logits[b * N_ACTIONS + k]! > logits[b * N_ACTIONS + best]!) best = k
        actions[b] = best
      }
      return { actions, logits, ms: performance.now() - t0 }
    }
    const raw = t.data as BigInt64Array | Int32Array
    if (raw.length !== req.batch) throw new Error('Unexpected action size')
    for (let b = 0; b < req.batch; b++) actions[b] = Number(raw[b])
    return { actions, logits: null, ms: performance.now() - t0 }
  }

  async dispose() {
    await this.session?.release?.()
    this.session = null
  }
}
