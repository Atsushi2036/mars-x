import '@/zod-config' // first import: zod jitless, so the worker never trips the CSP eval check
/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { PlannerService } from './planner-service'

const svc = new PlannerService()

const api = {
  setLayers(n: number, slope: Float32Array, rough: Float32Array) {
    svc.setLayers(n, slope, rough)
  },
  plan(request: unknown) {
    const res = svc.plan(request)
    return res.status === 'ok' ? Comlink.transfer(res, [res.path.buffer]) : res
  },
}
export type PlannerWorkerApi = typeof api

Comlink.expose(api)
