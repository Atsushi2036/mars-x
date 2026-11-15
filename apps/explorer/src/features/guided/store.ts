import { create } from 'zustand'
import { INITIAL, reduce, type TourAction, type TourState } from './machine'
import { STEP_COUNT } from './step-count'

interface TourStore extends TourState {
  /** the example run could not be fetched (not published with this dataset) */
  exampleMissing: boolean
  dispatch: (a: TourAction) => void
}

/** Tour state (pure machine in machine.ts). Light module: the Onboarding card and the topbar import it without pulling the UI. */
export const useTour = create<TourStore>((set, get) => ({
  ...INITIAL,
  exampleMissing: false,
  dispatch: (a) => {
    const { active, index } = get()
    set(reduce({ active, index }, a, STEP_COUNT))
  },
}))
