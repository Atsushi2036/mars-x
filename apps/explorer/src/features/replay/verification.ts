import { create } from 'zustand'
import type { Dataset } from '@/core/data/loader'
import type { RunSession } from '@/intelligence'
import { loadBaselines, type BaselineLoad } from './baselines'
import { loadSimTerrain } from './sim-terrain'
import { verifyRun, type VerificationSummary } from './verify'

interface VerificationState {
  session: RunSession | null
  status: 'idle' | 'running' | 'done' | 'error'
  progress: number
  summary: VerificationSummary | null
  error: string | null
  start: (session: RunSession, ds: Dataset) => void
  reset: () => void
}

let seq = 0

/** Replays the episodes of the loaded run (env-lite, main thread in short slices) and keeps the summary. */
export const useVerification = create<VerificationState>((set, get) => ({
  session: null,
  status: 'idle',
  progress: 0,
  summary: null,
  error: null,
  start: (session, ds) => {
    const cur = get()
    if (cur.session === session && cur.status !== 'idle') return
    const mine = ++seq
    set({ session, status: 'running', progress: 0, summary: null, error: null })
    void (async () => {
      try {
        const terrain = await loadSimTerrain(ds)
        const { run } = session.result
        const summary = await verifyRun(
          run.episodes,
          run.scenario.id,
          terrain,
          (ep) => session.trajectory(ep),
          (done, total) => {
            if (mine === seq) set({ progress: total ? done / total : 1 })
          },
        )
        if (mine === seq) set({ status: 'done', summary, progress: 1 })
      } catch (e) {
        if (mine === seq) set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      }
    })()
  },
  reset: () => {
    seq++
    set({ session: null, status: 'idle', progress: 0, summary: null, error: null })
  },
}))

interface BaselineState {
  base: string | null
  load: BaselineLoad | null
  ensure: (base: string) => void
}

export const useBaselines = create<BaselineState>((set, get) => ({
  base: null,
  load: null,
  ensure: (base) => {
    if (get().base === base) return
    set({ base, load: null })
    void loadBaselines(base).then((load) => {
      if (get().base === base) set({ load })
    })
  },
}))
