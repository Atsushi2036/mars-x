import { create } from 'zustand'
import type { LoadedPolicy, RunLoadResult, RunSession } from '@/intelligence'

/**
 * State of the "bring your own model" files. The Workers behind them live in a headless host that is
 * mounted for the whole session (features/lab/Host.tsx), so switching inspector modes does not drop
 * a loaded policy or run.
 */
export interface ByoState {
  run: { loading: boolean; error: string | null; session: RunSession | null; result: RunLoadResult | null; fileName: string | null }
  policy: { loading: boolean; error: string | null; loaded: LoadedPolicy | null; fileName: string | null }
  actions: {
    loadRun: (file: File) => void
    closeRun: () => void
    loadPolicy: (file: File) => void
    unloadPolicy: () => void
  }
}

const none = () => undefined

export const useByo = create<ByoState>(() => ({
  run: { loading: false, error: null, session: null, result: null, fileName: null },
  policy: { loading: false, error: null, loaded: null, fileName: null },
  actions: { loadRun: none, closeRun: none, loadPolicy: none, unloadPolicy: none },
}))
