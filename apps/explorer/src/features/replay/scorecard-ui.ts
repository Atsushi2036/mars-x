import { create } from 'zustand'
import { useByo } from '../shared/byo-store'

/** Whether the scorecard dialog of the loaded run is open. Shared so other features (the guided mission) can open it. */
export const useScorecardUi = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

export function openScorecard(): void {
  useScorecardUi.getState().setOpen(true)
}

// a new or closed run never inherits an open dialog
useByo.subscribe((s, prev) => {
  if (s.run.session !== prev.run.session) useScorecardUi.getState().setOpen(false)
})
