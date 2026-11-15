import { useTour } from './store'

/** Starts the guided mission from step 1 (also restarts it). Safe to call from any UI. */
export function startGuidedMission(): void {
  useTour.getState().dispatch({ type: 'start' })
}
