import { create } from 'zustand'
import { useMission } from '@/store/mission'
import { INITIAL, isPicking, reduce, type WizardCtx, type WizardEvent, type WizardState } from './machine'

interface WizardStore extends WizardState {
  dispatch: (e: WizardEvent) => void
}

function ctx(): WizardCtx {
  const m = useMission.getState()
  return { hasOrigin: !!m.origin, hasDestination: !!m.destination, profile: m.profile }
}

/** Plan-a-route wizard state (the transitions live in ./machine.ts). */
export const useWizard = create<WizardStore>((set, get) => ({
  ...INITIAL,
  dispatch: (e) => {
    const { dispatch: _d, ...cur } = get()
    void _d
    const next = reduce(cur, e, ctx())
    if (next.active !== cur.active || next.step !== cur.step || next.journey !== cur.journey) set(next)
  },
}))

/** Selector: the next tap on the map is a route endpoint. */
export const selectPicking = (s: WizardState): boolean => isPicking(s)
