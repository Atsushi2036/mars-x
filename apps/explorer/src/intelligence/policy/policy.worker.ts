import '@/zod-config' // first import: zod jitless, so the worker never trips the CSP eval check
/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { PolicyService } from './policy-service'

const svc = new PolicyService()

const api = {
  init(request: unknown) {
    return svc.init(request)
  },
  async infer(request: unknown) {
    const res = await svc.infer(request)
    const transfer: Transferable[] = [res.actions.buffer]
    if (res.logits) transfer.push(res.logits.buffer)
    return Comlink.transfer(res, transfer)
  },
}
export type PolicyWorkerApi = typeof api

Comlink.expose(api)
