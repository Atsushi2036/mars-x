import * as Comlink from 'comlink'
import { checkInferResponse, initResponseSchema, MAX_BATCH, type InferResponse, type InitResponse } from './messages'
import { MAX_MODEL_BYTES } from './onnx-validate'
import type { PolicyWorkerApi } from './policy.worker'

/**
 * Page-side handle for the ONNX policy worker. Responsibilities (security controls):
 *  - File.size is checked BEFORE reading; hard 20 MB cap
 *  - the main thread fetches the onnxruntime WASM and hands it over (the worker needs no network)
 *  - every worker response is re-validated with zod
 *  - any error or timeout terminates the worker (no zombie WASM instance, no leaked memory)
 */

export interface PolicyWorkerHandle {
  api: Pick<PolicyWorkerApi, 'init' | 'infer'>
  terminate(): void
}

export function createPolicyWorker(): PolicyWorkerHandle {
  const worker = new Worker(new URL('./policy.worker.ts', import.meta.url), { type: 'module' })
  return { api: Comlink.wrap<PolicyWorkerApi>(worker), terminate: () => worker.terminate() }
}

/** Fetches the self-hosted onnxruntime-web WASM (Vite emits it as a hashed static asset). */
export async function fetchOrtWasm(signal?: AbortSignal): Promise<ArrayBuffer> {
  const { default: url } = (await import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url')) as { default: string }
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Could not load the inference engine (HTTP ${res.status})`)
  return res.arrayBuffer()
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface LoadedPolicy {
  info: InitResponse
  /** sha256 of the model bytes (to compare with run.json policy.sha256 / the policy card) */
  sha256: string
  bytes: number
}

export interface PolicyClientOptions {
  factory?: () => PolicyWorkerHandle
  wasmLoader?: () => Promise<ArrayBuffer>
  initTimeoutMs?: number
  inferTimeoutMs?: number
}

export class PolicyClient {
  private handle: PolicyWorkerHandle | null = null
  private readonly factory: () => PolicyWorkerHandle
  private readonly wasmLoader: () => Promise<ArrayBuffer>
  private readonly initTimeoutMs: number
  private readonly inferTimeoutMs: number

  constructor(opts: PolicyClientOptions = {}) {
    this.factory = opts.factory ?? createPolicyWorker
    this.wasmLoader = opts.wasmLoader ?? (() => fetchOrtWasm())
    this.initTimeoutMs = opts.initTimeoutMs ?? 30_000
    this.inferTimeoutMs = opts.inferTimeoutMs ?? 10_000
  }

  get ready() {
    return this.handle !== null
  }

  /** Accepts a user-chosen File/Blob or raw bytes. Rejects (and leaves no worker) on any failure. */
  async load(model: Blob | ArrayBuffer): Promise<LoadedPolicy> {
    this.terminate()
    const size = model instanceof ArrayBuffer ? model.byteLength : model.size
    if (size <= 0) throw new Error('The model file is empty')
    if (size > MAX_MODEL_BYTES) throw new Error(`The model is larger than ${MAX_MODEL_BYTES / 1048576} MB`)
    const buf = model instanceof ArrayBuffer ? model.slice(0) : await model.arrayBuffer()
    const sha256 = await sha256Hex(buf)
    const wasm = await this.wasmLoader()
    const handle = this.factory()
    this.handle = handle
    try {
      const info = await this.guard(handle.api.init(Comlink.transfer({ wasmBinary: wasm, model: buf }, [wasm, buf])), this.initTimeoutMs, 'loading the model')
      return { info: initResponseSchema.parse(info), sha256, bytes: size }
    } catch (e) {
      this.terminate()
      throw e instanceof Error ? e : new Error(String(e))
    }
  }

  /** Batched inference. `obs` is batch * 505 float32 (obs/1). */
  async infer(obs: Float32Array, batch: number): Promise<InferResponse> {
    const h = this.handle
    if (!h) throw new Error('No policy loaded')
    if (batch < 1 || batch > MAX_BATCH) throw new Error('Invalid batch size')
    try {
      const copy = obs.slice() // keep the caller's buffer usable
      const res = await this.guard(h.api.infer(Comlink.transfer({ batch, obs: copy }, [copy.buffer])), this.inferTimeoutMs, 'running the model')
      return checkInferResponse(res, batch)
    } catch (e) {
      this.terminate()
      throw e instanceof Error ? e : new Error(String(e))
    }
  }

  terminate() {
    this.handle?.terminate()
    this.handle = null
  }

  private async guard<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out while ${what}`)), ms)
    })
    try {
      return await Promise.race([p, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}
