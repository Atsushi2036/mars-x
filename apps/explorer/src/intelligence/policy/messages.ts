import { z } from 'zod'
import { N_ACTIONS, OBS_DIM } from '../contracts'
import { MAX_MODEL_BYTES } from './onnx-validate'

/** zod schemas for every message crossing the policy-worker boundary (both directions). */

export const MAX_BATCH = 4096

export const initRequestSchema = z
  .object({
    /** onnxruntime-web WASM binary, fetched by the MAIN thread (the worker has no network) */
    wasmBinary: z.instanceof(ArrayBuffer).refine((b) => b.byteLength > 0 && b.byteLength <= 64 * 1024 * 1024, 'bad wasm size'),
    model: z.instanceof(ArrayBuffer).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_MODEL_BYTES, 'model must be 1 B .. 20 MB'),
  })
  .strict()
export type InitRequest = z.infer<typeof initRequestSchema>

export const inferRequestSchema = z
  .object({
    batch: z.number().int().min(1).max(MAX_BATCH),
    obs: z.instanceof(Float32Array),
  })
  .strict()
  .refine((m) => m.obs.length === m.batch * OBS_DIM, `obs length must be batch * ${OBS_DIM}`)
  .refine((m) => m.obs.every(Number.isFinite), 'obs contains non-finite values')
export type InferRequest = z.infer<typeof inferRequestSchema>

export const initResponseSchema = z
  .object({
    opset: z.number().int(),
    nodeCount: z.number().int(),
    ops: z.array(z.string().max(64)).max(256),
    outputName: z.enum(['logits', 'action']),
  })
  .strict()
export type InitResponse = z.infer<typeof initResponseSchema>

export const inferResponseSchema = z
  .object({
    /** argmax actions, act/1 indices */
    actions: z.instanceof(Int32Array),
    /** raw logits [batch * 9]; null when the model emits `action` directly */
    logits: z.instanceof(Float32Array).nullable(),
    ms: z.number().min(0),
  })
  .strict()
export type InferResponse = z.infer<typeof inferResponseSchema>

export function checkInferResponse(res: unknown, batch: number): InferResponse {
  const r = inferResponseSchema.parse(res)
  if (r.actions.length !== batch) throw new Error('worker returned a wrong number of actions')
  if (r.actions.some((a) => a < 0 || a >= N_ACTIONS)) throw new Error('worker returned an action outside act/1')
  if (r.logits && (r.logits.length !== batch * N_ACTIONS || !r.logits.every(Number.isFinite))) {
    throw new Error('worker returned invalid logits')
  }
  return r
}
