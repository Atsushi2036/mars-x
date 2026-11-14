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
