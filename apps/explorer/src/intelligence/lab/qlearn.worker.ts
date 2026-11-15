import '@/zod-config' // first import: zod jitless, so the worker never trips the CSP eval check
/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { QLearner, type QSetup, type QParams } from './qlearn'

let learner: QLearner | null = null

const api = {
  init(setup: QSetup) {
    learner = new QLearner(setup)
    return { optimum: learner.optimum, params: learner.getParams() }
  },
  setParams(patch: Partial<Omit<QParams, 'reward'>> & { reward?: Partial<QParams['reward']> }) {
    need().setParams(patch)
    return need().getParams()
  },
  runBatch(n: number, evalEvery = 100) {
    return need().runBatch(n, evalEvery)
  },
  /** Training batch plus step-by-step trajectories of the sampled episodes (buffers are transferred, not copied). */
  runBatchSampled(n: number, evalEvery: number, sampleEvery: number, maxSamples = 4) {
    const b = need().runBatchSampled(n, { evalEvery, sampleEvery, maxSamples })
    return Comlink.transfer(
      b,
      b.samples.flatMap((s) => [s.cells.buffer, s.reward.buffer, s.flags.buffer]),
    )
  },
  /** What the agent has learned so far: V(s) = max Q and the best action per cell. */
  snapshot() {
    const s = need().policySnapshot()
    return Comlink.transfer(s, [s.value.buffer, s.action.buffer])
  },
  greedyPath() {
    const g = need().greedyPath()
    return Comlink.transfer(g, [g.path.buffer])
  },
  valueMap() {
    const v = need().valueMap()
    return Comlink.transfer(v, [v.buffer])
  },
}
function need(): QLearner {
  if (!learner) throw new Error('Learner not initialised')
  return learner
}
export type QLearnWorkerApi = typeof api

Comlink.expose(api)
