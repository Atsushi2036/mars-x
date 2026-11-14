import { create } from 'zustand'
import { DEFAULT_SCENARIO_ID, scenarioById, type CommMode } from './scenarios'

export interface ScenarioState {
  scenarioId: string
  sol: number | null
  /** local mean solar time, hours */
  lmstH: number
  /** user override of dust opacity; null = scenario value */
  tauOverride: number | null
  comm: CommMode
  selectScenario: (id: string) => void
  setSol: (sol: number) => void
  setLmst: (h: number) => void
  setTau: (tau: number | null) => void
  setComm: (c: CommMode) => void
}

const initial = scenarioById(DEFAULT_SCENARIO_ID)

export const useScenario = create<ScenarioState>((set) => ({
  scenarioId: initial.id,
  sol: initial.sol,
  lmstH: initial.lmstH,
  tauOverride: null,
  comm: initial.comm,
  selectScenario: (id) => {
    const s = scenarioById(id)
    set({ scenarioId: s.id, sol: s.sol, lmstH: s.lmstH, tauOverride: null, comm: s.comm })
  },
  setSol: (sol) => set({ sol }),
  setLmst: (lmstH) => set({ lmstH: Math.min(24.65, Math.max(0, lmstH)) }),
  setTau: (tauOverride) => set({ tauOverride }),
  setComm: (comm) => set({ comm }),
}))
