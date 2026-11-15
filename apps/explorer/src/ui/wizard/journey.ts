import { startJourney } from '@/store/watch'

/**
 * The one place the wizard starts the journey from. `startJourney()` honours the driver picked in "Who drives?"
 * (A* plan replay, a catalog model, or the user's own ONNX running live).
 */
export function beginJourney(): boolean {
  return startJourney()
}
